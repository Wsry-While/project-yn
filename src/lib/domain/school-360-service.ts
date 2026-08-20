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
  /** 归一化后的项目名（用于聚类；可能为空字符串表示"日常/未归属"） */
  projectKey: string;
  /** 原始项目名（用于展示） */
  projectName: string;
}

export interface School360ProjectThread {
  /** 聚类主键：归一化项目名，空串代表"未归属到具体项目" */
  key: string;
  /** 展示名（取该组内出现频次最高的原始项目名） */
  displayName: string;
  /** 涉及的业务源 */
  sources: Array<'trip' | 'bidding' | 'demand' | 'qiming'>;
  items: School360TimelineItem[];
  /** 该项目下最早/最晚业务日期 */
  startDate: string | null;
  endDate: string | null;
  /** 是否存在未完成项 */
  hasOpen: boolean;
}

export interface School360View extends School360Summary {
  timeline: School360TimelineItem[];
  /** 按项目名聚类后的业务主线，每条线内按日期升序 */
  threads: School360ProjectThread[];
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
        .select('id, company, demand_type, product, required_finish_date, completion_status, sales_manager, project_manager')
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
      ...tripRows.map((r) => {
        const support = String(r.support_type ?? '');
        return {
          id: r.id as string,
          source: 'trip' as const,
          date: (r.trip_date as string | null) ?? null,
          title: `项目外出 · ${support}`,
          subtitle: joinPeople(r.sales_manager_name, r.project_manager_name),
          status: r.is_completed ? '已完成' : '待反馈',
          isOpen: !r.is_completed,
          url: `/trips?focus=${r.id}`,
          projectKey: '',
          projectName: support,
          rawText: support,
        };
      }),
      ...bidRows.map((r) => {
        const name = String(r.project_name ?? '').trim();
        return {
          id: r.id as string,
          source: 'bidding' as const,
          date: (r.submission_date as string | null) ?? null,
          title: `招投标 · ${name}`,
          subtitle: joinPeople(r.sales_manager, r.assigned_project_manager),
          status: (r.completion_status as string | null) ?? '未填',
          isOpen: isOpenStatus(r.completion_status as string | null),
          url: `/bidding-screenshots?focus=${r.id}`,
          projectKey: normalizeProjectName(name),
          projectName: name,
          rawText: name,
        };
      }),
      ...demandRows.map((r) => {
        const dtype = String(r.demand_type ?? '');
        const prod = String(r.product ?? '');
        return {
          id: r.id as string,
          source: 'demand' as const,
          date: (r.required_finish_date as string | null) ?? null,
          title: `建设申请 · ${dtype || prod || '未命名'}`,
          subtitle: joinPeople(r.sales_manager, r.project_manager),
          status: (r.completion_status as string | null) ?? '未填',
          isOpen: isOpenStatus(r.completion_status as string | null),
          url: `/project-demands?focus=${r.id}`,
          projectKey: '',
          projectName: dtype || prod,
          rawText: [dtype, prod].filter(Boolean).join(' '),
        };
      }),
      ...qimingRows.map((r) => {
        const name = String(r.project_name ?? '').trim();
        return {
          id: r.id as string,
          source: 'qiming' as const,
          date: (r.project_delivery_time as string | null) ?? null,
          title: `启明星 · ${name}`,
          subtitle: joinPeople(r.sales_manager, r.project_manager),
          status:
            (r.project_status_feedback as string | null) ??
            (r.project_year ? `年度 ${r.project_year}` : null),
          isOpen: isOpenStatus(r.project_status_feedback as string | null),
          url: `/qiming-construction?focus=${r.id}`,
          projectKey: normalizeProjectName(name),
          projectName: name,
          rawText: name,
        };
      }),
    ];

    // 二次归类：trips / demands 若文本中包含某个具名项目关键词，则归入对应主线
    const namedKeys = Array.from(
      new Set(
        timeline
          .filter((it) => it.projectKey && (it.source === 'bidding' || it.source === 'qiming'))
          .map((it) => it.projectKey),
      ),
    );
    for (const it of timeline) {
      if (it.projectKey) continue;
      const haystack = `${it.title} ${it.subtitle ?? ''} ${it.projectName ?? ''}`.toLowerCase();
      const matched = namedKeys.find((key) => key && haystack.includes(key));
      if (matched) it.projectKey = matched;
    }

    const threads = buildThreads(timeline);

    timeline.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });

    return { ...summary, timeline: timeline.slice(0, 50), threads };
  }
}

function normalizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s\u3000\-_·•・（）()【】\[\]"'']+/g, '')
    .replace(/(项目|工程|建设|一期|二期|三期)/g, '')
    .trim();
}

function buildThreads(timeline: School360TimelineItem[]): School360ProjectThread[] {
  type MutableItem = School360TimelineItem & { rawText?: string };
  const groups = new Map<string, MutableItem[]>();
  const displayNames = new Map<string, Map<string, number>>();

  for (const item of timeline as MutableItem[]) {
    const key = item.projectKey || '__ungrouped__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
    if (item.projectName) {
      if (!displayNames.has(key)) displayNames.set(key, new Map());
      const nm = displayNames.get(key)!;
      nm.set(item.projectName, (nm.get(item.projectName) ?? 0) + 1);
    }
  }

  const threads: School360ProjectThread[] = [];
  for (const [key, items] of groups) {
    const sorted = [...items].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    const sourcesSet = new Set(sorted.map((i) => i.source));
    const dates = sorted.map((i) => i.date).filter((d): d is string => !!d);
    const nameMap = displayNames.get(key);
    let displayName: string;
    if (key === '__ungrouped__') {
      displayName = '日常运营 / 未归属项目';
    } else if (nameMap && nameMap.size > 0) {
      // 取出现频次最高的项目名；若并列选更长的那个（信息更多）
      const entries = Array.from(nameMap.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return b[0].length - a[0].length;
      });
      displayName = entries[0][0];
    } else {
      displayName = key;
    }
    threads.push({
      key,
      displayName,
      sources: ['bidding', 'demand', 'qiming', 'trip'].filter((s) =>
        sourcesSet.has(s as School360TimelineItem['source']),
      ) as School360ProjectThread['sources'],
      items: sorted.map(({ rawText: _raw, ...rest }) => rest),
      startDate: dates[0] ?? null,
      endDate: dates[dates.length - 1] ?? null,
      hasOpen: sorted.some((i) => i.isOpen),
    });
  }

  // 排序：有未完成项的在前，然后按最近日期倒序
  threads.sort((a, b) => {
    if (a.hasOpen !== b.hasOpen) return a.hasOpen ? -1 : 1;
    const ad = a.endDate ?? '';
    const bd = b.endDate ?? '';
    return ad < bd ? 1 : ad > bd ? -1 : 0;
  });

  return threads;
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
