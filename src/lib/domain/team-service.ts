import type { SupabaseClient } from '@supabase/supabase-js';
import type { Member, MemberRole } from '@/lib/domain/types';
import { mapMember, type MemberRow } from '@/lib/domain/mappers';

/**
 * 团队成员数据访问层。
 * 角色变更、加入、移除都经过此服务；RLS 已限制只有 admin/owner 能写。
 */
export class TeamService {
  constructor(private readonly db: SupabaseClient) {}

  async listByProject(projectId: string): Promise<Member[]> {
    const { data, error } = await this.db
      .from('project_members')
      .select('*')
      .eq('project_id', projectId)
      .order('joined_at', { ascending: true });
    if (error) throw error;
    return (data as MemberRow[]).map(mapMember);
  }

  async upsert(input: {
    projectId: string;
    userId: string;
    role: MemberRole;
    displayName?: string | null;
    title?: string | null;
    avatarUrl?: string | null;
  }): Promise<Member> {
    const { data, error } = await this.db
      .from('project_members')
      .upsert(
        {
          project_id: input.projectId,
          user_id: input.userId,
          role: input.role,
          display_name: input.displayName ?? null,
          title: input.title ?? null,
          avatar_url: input.avatarUrl ?? null,
        },
        { onConflict: 'project_id,user_id' },
      )
      .select()
      .single();
    if (error) throw error;
    return mapMember(data as MemberRow);
  }

  async remove(projectId: string, userId: string): Promise<void> {
    const { error } = await this.db
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (error) throw error;
  }
}
