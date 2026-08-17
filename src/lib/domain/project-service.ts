import type { SupabaseClient } from '@supabase/supabase-js';
import type { Project, ProjectSettings, ProjectType } from '@/lib/domain/types';
import {
  DEFAULT_PROJECT_SETTINGS,
  mapProject,
  type ProjectRow,
} from '@/lib/domain/mappers';

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  ownerId: string;
  projectType?: ProjectType;
  schoolId?: string | null;
  departmentId?: string | null;
  industry?: string | null;
  products?: string[];
  startDate?: string | null;
  endDate?: string | null;
}

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

  async create(input: CreateProjectInput): Promise<Project> {
    const { data, error } = await this.db
      .from('projects')
      .insert({
        name: input.name,
        description: input.description ?? null,
        owner_id: input.ownerId,
        project_type: input.projectType ?? 'construction',
        school_id: input.schoolId ?? null,
        department_id: input.departmentId ?? null,
        industry: input.industry ?? null,
        products: input.products ?? [],
        start_date: input.startDate ?? null,
        end_date: input.endDate ?? null,
        settings: DEFAULT_PROJECT_SETTINGS,
      })
      .select()
      .single();
    if (error) throw error;

    const project = mapProject(data as ProjectRow);

    await this.db.from('project_members').insert({
      project_id: project.id,
      user_id: input.ownerId,
      role: 'owner',
    });

    // 按项目类型初始化默认里程碑
    const defaults = DEFAULT_MILESTONES[project.projectType] ?? [];
    if (defaults.length > 0) {
      await this.db.from('project_milestones').insert(
        defaults.map((name, i) => ({
          project_id: project.id,
          name,
          position: i + 1,
          status: 'todo',
        })),
      );
    }

    return project;
  }

  async update(
    projectId: string,
    patch: Partial<{
      name: string;
      description: string | null;
      projectType: ProjectType;
      schoolId: string | null;
      departmentId: string | null;
      industry: string | null;
      products: string[];
      startDate: string | null;
      endDate: string | null;
      settings: ProjectSettings;
    }>,
  ): Promise<Project> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.projectType !== undefined) row.project_type = patch.projectType;
    if (patch.schoolId !== undefined) row.school_id = patch.schoolId;
    if (patch.departmentId !== undefined) row.department_id = patch.departmentId;
    if (patch.industry !== undefined) row.industry = patch.industry;
    if (patch.products !== undefined) row.products = patch.products;
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

  async softDelete(projectId: string): Promise<void> {
    const { error } = await this.db
      .from('projects')
      .update({ status: 'deleted' })
      .eq('id', projectId);
    if (error) throw error;
  }
}

export const DEFAULT_MILESTONES: Record<ProjectType, string[]> = {
  bidding: ['招标公告', '报名/答疑', '标书制作', '投标上传', '开标结果', '资料归档'],
  qiming: ['需求确认', '课程规划', '课程生成', '课程审核', '课程导入', '教师培训', '结项归档'],
  construction: ['商机跟进', '需求调研', '方案设计', '招投标', '合同签订', '项目实施', '验收交付', '售后维护'],
  operation: ['申请受理', '外出执行', '回访归档'],
  other: ['待办', '进行中', '已完成'],
};
