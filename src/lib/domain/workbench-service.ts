import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCurrentMemberId } from './current-member';

export type WorkbenchSource = 'trip' | 'bidding' | 'demand' | 'qiming';
export type WorkbenchRole = 'sales' | 'pm';
export type WorkbenchBucket = 'overdue' | 'today' | 'week' | 'later';

export interface WorkbenchItem {
  id: string;
  source: WorkbenchSource;
  title: string;
  school: string | null;
  date: string | null;
  role: WorkbenchRole;
  completionStatus: string | null;
  isCompleted: boolean;
  url: string;
}

export interface MyWorkbench {
  member: { id: string; name: string } | null;
  counts: {
    total: number;
    overdue: number;
    today: number;
    week: number;
    later: number;
  };
  bySource: Record<WorkbenchSource, number>;
  items: Record<WorkbenchBucket, WorkbenchItem[]>;
}

interface SessionUserLike {
  chaoxing: { uid: string; name?: string; displayName?: string };
}

const COMPLETED_KEYWORDS = ['已完成', '已交付', '完成', '已结项', 'closed', 'done'];

function isCompletedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.trim();
  if (!s) return false;
  return COMPLETED_KEYWORDS.some((k) => s.includes(k));
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function bucketOf(dateStr: string | null, today: Date): WorkbenchBucket {
  if (!dateStr) return 'later';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return 'later';
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((d.getTime() - todayStart.getTime()) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'week';
  return 'later';
}

/**
 * 我的工作台：按当前登录用户（team_members.id）在四张业务表里
 * UNION 出所有"我作为销售或项目经理且未完成"的工单，按日期分桶。
 *
 * 时间字段：
 *   - trip: trip_date（外出日期，已发生仍展示直到反馈完成）
 *   - bidding: due_delivery_date（需交付日期）
 *   - demand: required_finish_date（要求完成时间）
 *   - qiming: project_delivery_time（项目交付时间）
 */
export class WorkbenchService {
  constructor(private readonly db: SupabaseClient) {}

  async forUser(user: SessionUserLike): Promise<MyWorkbench> {
    const memberId = await resolveCurrentMemberId(this.db, user);
    const empty: MyWorkbench = {
      member: null,
      counts: { total: 0, overdue: 0, today: 0, week: 0, later: 0 },
      bySource: { trip: 0, bidding: 0, demand: 0, qiming: 0 },
      items: { overdue: [], today: [], week: [], later: [] },
    };
    if (!memberId) return empty;

    const { data: member } = await this.db
      .from('team_members')
      .select('id, name')
      .eq('id', memberId)
      .maybeSingle<{ id: string; name: string }>();
    if (!member) return empty;

    const today = new Date();
    const items: WorkbenchItem[] = [];

    await Promise.all([
      this.collectTrips(memberId, items),
      this.collectBidding(memberId, items),
      this.collectDemands(memberId, items),
      this.collectQiming(memberId, items),
    ]);

    const buckets: Record<WorkbenchBucket, WorkbenchItem[]> = {
      overdue: [],
      today: [],
      week: [],
      later: [],
    };
    const bySource: Record<WorkbenchSource, number> = { trip: 0, bidding: 0, demand: 0, qiming: 0 };

    for (const it of items) {
      if (it.isCompleted) continue;
      // trips 比较特殊：外出日期已过但 is_completed=false（未填反馈）也要在逾期里提醒
      const b = bucketOf(it.date, today);
      buckets[b].push(it);
      bySource[it.source] += 1;
    }

    const cmp = (a: WorkbenchItem, b: WorkbenchItem) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    };
    buckets.overdue.sort(cmp);
    buckets.today.sort(cmp);
    buckets.week.sort(cmp);
    buckets.later.sort(cmp);

    return {
      member: { id: member.id, name: member.name },
      counts: {
        total: items.filter((i) => !i.isCompleted).length,
        overdue: buckets.overdue.length,
        today: buckets.today.length,
        week: buckets.week.length,
        later: buckets.later.length,
      },
      bySource,
      items: buckets,
    };
  }

  private async collectTrips(memberId: string, sink: WorkbenchItem[]): Promise<void> {
    const { data } = await this.db
      .from('trip_requests')
      .select(
        'id, school_name, school_id, support_type, trip_date, sales_manager_id, project_manager_id, is_completed',
      )
      .is('deleted_at', null)
      .or(`sales_manager_id.eq.${memberId},project_manager_id.eq.${memberId}`);
    if (!data) return;
    for (const r of data as Array<Record<string, unknown>>) {
      const isSales = r.sales_manager_id === memberId;
      sink.push({
        id: r.id as string,
        source: 'trip',
        title: `项目外出 · ${String(r.support_type ?? '')}`,
        school: r.school_name as string | null,
        date: (r.trip_date as string | null) ?? null,
        role: isSales ? 'sales' : 'pm',
        completionStatus: r.is_completed ? '已完成' : '待反馈',
        isCompleted: Boolean(r.is_completed),
        url: `/trips?focus=${r.id}`,
      });
    }
  }

  private async collectBidding(memberId: string, sink: WorkbenchItem[]): Promise<void> {
    const { data } = await this.db
      .from('bidding_screenshots')
      .select(
        'id, project_name, project_school, due_delivery_date, sales_manager_id, assigned_pm_id, completion_status',
      )
      .is('deleted_at', null)
      .or(`sales_manager_id.eq.${memberId},assigned_pm_id.eq.${memberId}`);
    if (!data) return;
    for (const r of data as Array<Record<string, unknown>>) {
      const isSales = r.sales_manager_id === memberId;
      const status = (r.completion_status as string | null) ?? null;
      sink.push({
        id: r.id as string,
        source: 'bidding',
        title: `招投标 · ${String(r.project_name ?? '')}`,
        school: r.project_school as string | null,
        date: (r.due_delivery_date as string | null) ?? null,
        role: isSales ? 'sales' : 'pm',
        completionStatus: status,
        isCompleted: isCompletedStatus(status),
        url: `/bidding-screenshots?focus=${r.id}`,
      });
    }
  }

  private async collectDemands(memberId: string, sink: WorkbenchItem[]): Promise<void> {
    const { data } = await this.db
      .from('project_demands')
      .select(
        'id, company, demand_type, required_finish_date, sales_manager_id, project_manager_id, completion_status',
      )
      .is('deleted_at', null)
      .or(`sales_manager_id.eq.${memberId},project_manager_id.eq.${memberId}`);
    if (!data) return;
    for (const r of data as Array<Record<string, unknown>>) {
      const isSales = r.sales_manager_id === memberId;
      const status = (r.completion_status as string | null) ?? null;
      sink.push({
        id: r.id as string,
        source: 'demand',
        title: `建设申请 · ${String(r.demand_type ?? '')}`,
        school: r.company as string | null,
        date: (r.required_finish_date as string | null) ?? null,
        role: isSales ? 'sales' : 'pm',
        completionStatus: status,
        isCompleted: isCompletedStatus(status),
        url: `/project-demands?focus=${r.id}`,
      });
    }
  }

  private async collectQiming(memberId: string, sink: WorkbenchItem[]): Promise<void> {
    const { data } = await this.db
      .from('qiming_construction')
      .select(
        'id, project_name, school, college, project_delivery_time, sales_manager_id, project_manager_id, project_status_feedback',
      )
      .is('deleted_at', null)
      .or(`sales_manager_id.eq.${memberId},project_manager_id.eq.${memberId}`);
    if (!data) return;
    for (const r of data as Array<Record<string, unknown>>) {
      const isSales = r.sales_manager_id === memberId;
      const fb = (r.project_status_feedback as string | null) ?? null;
      // 启明星没有显式"完成情况"字段：项目交付时间已过且有反馈视为已完成
      const delivered =
        r.project_delivery_time &&
        new Date(String(r.project_delivery_time)).getTime() < Date.now() &&
        fb &&
        fb.trim().length > 0;
      sink.push({
        id: r.id as string,
        source: 'qiming',
        title: `启明星 · ${String(r.project_name ?? '')}`,
        school: ((r.school as string | null) ?? null) + (r.college ? ` / ${r.college}` : ''),
        date: (r.project_delivery_time as string | null) ?? null,
        role: isSales ? 'sales' : 'pm',
        completionStatus: fb,
        isCompleted: Boolean(delivered),
        url: `/qiming-construction?focus=${r.id}`,
      });
    }
  }
}

// 暴露 toYmd 便于前端/其他服务复用日期分桶边界
export const workbenchToday = toYmd;
