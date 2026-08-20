import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 学校 360 视图所需的聚合数据：
 * - summary: 四大业务表计数（全部、近 12 个月、未完成）
 * - timeline: 跨四表的最近 50 条事件流（按日期倒序）
 */

export interface School360Summary {
  schoolId: string;
  counts: {
    trips: { total: number; open: number; year: number };
    bidding: { total: number; open: number; year: number };
    demands: { total: number; open: number; year: number };
    qiming: { total: number; open: number; year: number };
  };
}

export interface School360TimelineItem {
  id: string;
  source: 'trip' | 'bidding' | 'demand' | 'qiming';
  date: string | null;
  title: string;
  subtitle: string | null;
  status: string | null;
  isOpen: boolean;
  url: string;
}

export interface School360View extends School360Summary {
  timeline: School360TimelineItem[];
}

const COMPLETED_KEYWORDS = ['已完成', '已交付', '完成', '已结项'];

function isOpenStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  const s = status.trim();
  if (!s) return true;
  return !COMPLETED_KEYWORDS.some((k) => s.includes(k));
}

function yearAgoYmd(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export class School360Service {
  constructor(private readonly db: SupabaseClient) {}

  async get(schoolId: string): Promise<School360View> {
    const since = yearAgoYmd();

    const [trips, bidding, demands, qiming] = await Promise.all([
      this.db
        .from('trip_requests')
        .select('id, school_name, support_type, trip_date, is_completed, sales_manager_name, project_manager_name')
        .eq('school_id', schoolId)
        .is('deleted_at', null),
      this.db
        .from('bidding_screenshots')
        .select('id, project_name, project_secondary_unit, submission_date, due_delivery_date, completion_status, sales_manager, assigned_project_manager')
        .eq('school_id', schoolId)
        .is('deleted_at', null),
      this.db
        .from('project_demands')
        .select('id, company, demand_type, required_finish_date, completion_status, sales_manager, project_manager')
        .eq('school_id', schoolId)
        .is('deleted_at', null),
      this.db
        .from('qiming_construction')
        .select('id, project_name, college, project_year, project_delivery_time, project_status_feedback, sales_manager, project_manager')
        .eq('school_id', schoolId)
        .is('deleted_at', null),
    ]);

    if (trips.error) throw new Error(`查询外出失败: ${trips.error.message}`);
    if (bidding.error) throw new Error(`查询招投标失败: ${bidding.error.message}`);
    if (demands.error) throw new Error(`查询建设申请失败: ${demands.error.message}`);
    if (qiming.error) throw new Error(`查询启明星失败: ${qiming.error.message}`);

    const tripRows = (trips.data ?? []) as Array<Record<string, unknown>>;
    const bidRows = (bidding.data ?? []) as Array<Record<string, unknown>>;
    const demandRows = (demands.data ?? []) as Array<Record<string, unknown>>;
    const qimingRows = (qiming.data ?? []) as Array<Record<string, unknown>>;

    const summary: School360Summary = {
      schoolId,
      counts: {
        trips: countBucket(tripRows, 'trip_date', (r) => !r.is_completed, since),
        bidding: countBucket(bidRows, 'submission_date', (r) => isOpenStatus(r.completion_status as string | null), since),
        demands: countBucket(demandRows, 'required_finish_date', (r) => isOpenStatus(r.completion_status as string | null), since),
        qiming: countBucket(qimingRows, 'project_delivery_time', (r) => isOpenStatus(r.project_status_feedback as string | null), since),
      },
    };

    const timeline: School360TimelineItem[] = [
      ...tripRows.map((r) => ({
        id: r.id as string,
        source: 'trip' as const,
        date: (r.trip_date as string | null) ?? null,
        title: `项目外出 · ${String(r.support_type ?? '')}`,
        subtitle: joinPeople(r.sales_manager_name, r.project_manager_name),
        status: r.is_completed ? '已完成' : '待反馈',
        isOpen: !r.is_completed,
        url: `/trips?focus=${r.id}`,
      })),
      ...bidRows.map((r) => ({
        id: r.id as string,
        source: 'bidding' as const,
        date: (r.submission_date as string | null) ?? null,
        title: `招投标 · ${String(r.project_name ?? '')}`,
        subtitle: joinPeople(r.sales_manager, r.assigned_project_manager),
        status: (r.completion_status as string | null) ?? '未填',
        isOpen: isOpenStatus(r.completion_status as string | null),
        url: `/bidding-screenshots?focus=${r.id}`,
      })),
      ...demandRows.map((r) => ({
        id: r.id as string,
        source: 'demand' as const,
        date: (r.required_finish_date as string | null) ?? null,
        title: `建设申请 · ${String(r.demand_type ?? '')}`,
        subtitle: joinPeople(r.sales_manager, r.project_manager),
        status: (r.completion_status as string | null) ?? '未填',
        isOpen: isOpenStatus(r.completion_status as string | null),
        url: `/project-demands?focus=${r.id}`,
      })),
      ...qimingRows.map((r) => ({
        id: r.id as string,
        source: 'qiming' as const,
        date: (r.project_delivery_time as string | null) ?? null,
        title: `启明星 · ${String(r.project_name ?? '')}`,
        subtitle: joinPeople(r.sales_manager, r.project_manager),
        status: (r.project_status_feedback as string | null) ?? (r.project_year ? `年度 ${r.project_year}` : null),
        isOpen: isOpenStatus(r.project_status_feedback as string | null),
        url: `/qiming-construction?focus=${r.id}`,
      })),
    ];

    timeline.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });

    return { ...summary, timeline: timeline.slice(0, 50) };
  }
}

function countBucket(
  rows: Array<Record<string, unknown>>,
  dateField: string,
  isOpen: (r: Record<string, unknown>) => boolean,
  since: string,
): { total: number; open: number; year: number } {
  let open = 0;
  let year = 0;
  for (const r of rows) {
    if (isOpen(r)) open++;
    const d = r[dateField] as string | null;
    if (d && d.slice(0, 10) >= since) year++;
  }
  return { total: rows.length, open, year };
}

function joinPeople(a: unknown, b: unknown): string | null {
  const parts = [a, b]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join(' / ') : null;
}
