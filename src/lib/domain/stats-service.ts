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
}
