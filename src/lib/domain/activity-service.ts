import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActivityLog } from '@/lib/domain/types';
import { mapActivity, type ActivityRow } from '@/lib/domain/mappers';

export interface ActivityInput {
  projectId: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  entityTitle?: string | null;
  payload?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * 操作日志服务。所有写操作都应调用 record() 产生一条活动记录，
 * 仪表盘时间线读取 listByProject() 展示。
 */
export class ActivityService {
  constructor(private readonly db: SupabaseClient) {}

  async record(input: ActivityInput): Promise<void> {
    const { error } = await this.db.from('activity_log').insert({
      project_id: input.projectId,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      entity_title: input.entityTitle ?? null,
      payload: input.payload ?? {},
      ip: input.ip ?? null,
    });
    if (error) {
      // 日志失败不应阻断主流程
      console.error('[activity] failed to record:', error);
    }
  }

  async listByProject(projectId: string, limit = 30): Promise<ActivityLog[]> {
    const { data, error } = await this.db
      .from('activity_log')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as ActivityRow[]).map(mapActivity);
  }
}
