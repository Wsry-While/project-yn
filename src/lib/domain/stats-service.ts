import type { SupabaseClient } from '@supabase/supabase-js';
import type { Task, TaskStatus } from '@/lib/domain/types';
import { mapTask, type TaskRow } from '@/lib/domain/mappers';

export interface DashboardStats {
  totals: Record<TaskStatus, number>;
  total: number;
  doneRatio: number;
  upcoming: Task[];
  overdue: Task[];
}

export interface TrendPoint {
  date: string;
  created: number;
  completed: number;
}

export interface TypeDistributionPoint {
  type: string;
  count: number;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 仪表盘统计服务。只做只读聚合，逻辑保持简单以便 RLS 直接收敛。
 */
export class StatsService {
  constructor(private readonly db: SupabaseClient) {}

  async dashboard(projectId: string): Promise<DashboardStats> {
    const { data, error } = await this.db
      .from('tasks')
      .select('*')
      .eq('project_id', projectId);
    if (error) throw error;
    const tasks = (data as TaskRow[]).map(mapTask);

    const totals: Record<TaskStatus, number> = {
      todo: 0,
      in_progress: 0,
      review: 0,
      done: 0,
    };
    const now = Date.now();
    const upcoming: Task[] = [];
    const overdue: Task[] = [];

    for (const t of tasks) {
      totals[t.status] += 1;
      if (t.status !== 'done' && t.dueDate) {
        const due = new Date(t.dueDate).getTime();
        if (due < now) overdue.push(t);
        else if (due - now < 7 * 24 * 3600 * 1000) upcoming.push(t);
      }
    }

    const total = tasks.length;
    return {
      totals,
      total,
      doneRatio: total === 0 ? 0 : totals.done / total,
      upcoming: upcoming.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)).slice(0, 6),
      overdue: overdue.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)).slice(0, 6),
    };
  }

  /** 最近 30 天的「每日新建 / 每日完成」趋势。 */
  async trend(projectId: string, days = 30): Promise<TrendPoint[]> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const { data, error } = await this.db
      .from('tasks')
      .select('created_at, updated_at, status')
      .eq('project_id', projectId)
      .gte('created_at', since.toISOString());
    if (error) throw error;

    const buckets: TrendPoint[] = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      buckets.push({ date: ymd(d), created: 0, completed: 0 });
    }
    const index = new Map(buckets.map((b) => [b.date, b]));
    for (const row of (data ?? []) as Array<{ created_at: string | null; updated_at: string | null; status: string }>) {
      if (row.created_at) {
        const key = ymd(new Date(row.created_at));
        const b = index.get(key);
        if (b) b.created += 1;
      }
      // tasks 表没有 completed_at 字段，用 status=done 的 updated_at 近似完成时间
      if (row.status === 'done' && row.updated_at) {
        const key = ymd(new Date(row.updated_at));
        const b = index.get(key);
        if (b) b.completed += 1;
      }
    }
    return buckets;
  }

  /** 按任务类型统计数量。 */
  async byType(projectId: string): Promise<TypeDistributionPoint[]> {
    const { data, error } = await this.db
      .from('tasks')
      .select('task_type')
      .eq('project_id', projectId);
    if (error) throw error;
    const map = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ task_type: string | null }>) {
      const key = (row.task_type || '未分类').trim();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }
}
