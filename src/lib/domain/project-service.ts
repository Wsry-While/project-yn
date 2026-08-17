import type { SupabaseClient } from '@supabase/supabase-js';
import type { Project, ProjectSettings } from '@/lib/domain/types';
import {
  DEFAULT_PROJECT_SETTINGS,
  mapProject,
  type ProjectRow,
} from '@/lib/domain/mappers';

/**
 * 项目数据访问层。所有查询使用 Supabase PostgREST（HTTP），
 * 不直接连 PG，也不使用 Drizzle ORM。
 */
export class ProjectService {
  constructor(private readonly db: SupabaseClient) {}

  async listForUser(userId: string): Promise<Project[]> {
    const { data, error } = await this.db
      .from('projects')
      .select('*')
      .or(`owner_id.eq.${userId},project_members.user_id.eq.${userId}`)
      .eq('status', 'active')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data as ProjectRow[]).map(mapProject);
  }

  /** 返回当前用户的第一个 active 项目，若没有则返回 null。 */
  async findFirstForUser(userId: string): Promise<Project | null> {
    const list = await this.listForUser(userId);
    return list[0] ?? null;
  }

  async getById(projectId: string): Promise<Project | null> {
    const { data, error } = await this.db
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapProject(data as ProjectRow) : null;
  }

  async create(input: {
    name: string;
    description?: string | null;
    ownerId: string;
    startDate?: string | null;
    endDate?: string | null;
  }): Promise<Project> {
    const { data, error } = await this.db
      .from('projects')
      .insert({
        name: input.name,
        description: input.description ?? null,
        owner_id: input.ownerId,
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        settings: DEFAULT_PROJECT_SETTINGS,
      })
      .select()
      .single();
    if (error) throw error;

    // 创建者自动加入成员表，role=owner
    await this.db.from('project_members').insert({
      project_id: (data as ProjectRow).id,
      user_id: input.ownerId,
      role: 'owner',
    });

    return mapProject(data as ProjectRow);
  }

  async update(
    projectId: string,
    patch: Partial<{
      name: string;
      description: string | null;
      startDate: string | null;
      endDate: string | null;
      settings: ProjectSettings;
    }>,
  ): Promise<Project> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.startDate !== undefined) row.start_date = patch.startDate;
    if (patch.endDate !== undefined) row.end_date = patch.endDate;
    if (patch.settings !== undefined) row.settings = patch.settings;

    const { data, error } = await this.db
      .from('projects')
      .update(row)
      .eq('id', projectId)
      .select()
      .single();
    if (error) throw error;
    return mapProject(data as ProjectRow);
  }

  /** 软删除：status='deleted'，保留数据便于审计。 */
  async softDelete(projectId: string): Promise<void> {
    const { error } = await this.db
      .from('projects')
      .update({ status: 'deleted' })
      .eq('id', projectId);
    if (error) throw error;
  }
}
