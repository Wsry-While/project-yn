import type { SupabaseClient } from '@supabase/supabase-js';
import type { Milestone, TaskStatus } from '@/lib/domain/types';
import { mapMilestone, type MilestoneRow } from '@/lib/domain/mappers';

export class MilestoneService {
  constructor(private readonly db: SupabaseClient) {}

  async listByProject(projectId: string): Promise<Milestone[]> {
    const { data, error } = await this.db
      .from('project_milestones')
      .select('*')
      .eq('project_id', projectId)
      .order('position');
    if (error) throw error;
    return (data as MilestoneRow[]).map(mapMilestone);
  }

  async create(input: {
    projectId: string;
    name: string;
    description?: string | null;
    position?: number;
    dueDate?: string | null;
    status?: TaskStatus;
  }): Promise<Milestone> {
    const { data, error } = await this.db
      .from('project_milestones')
      .insert({
        project_id: input.projectId,
        name: input.name,
        description: input.description ?? null,
        position: input.position ?? 0,
        due_date: input.dueDate ?? null,
        status: input.status ?? 'todo',
      })
      .select()
      .single();
    if (error) throw error;
    return mapMilestone(data as MilestoneRow);
  }

  async update(
    id: string,
    patch: Partial<Pick<Milestone, 'name' | 'description' | 'position' | 'status' | 'dueDate'>>,
  ): Promise<Milestone> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.position !== undefined) row.position = patch.position;
    if (patch.status !== undefined) {
      row.status = patch.status;
      row.completed_at = patch.status === 'done' ? new Date().toISOString() : null;
    }
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
    const { data, error } = await this.db
      .from('project_milestones')
      .update(row)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapMilestone(data as MilestoneRow);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from('project_milestones').delete().eq('id', id);
    if (error) throw error;
  }
}
