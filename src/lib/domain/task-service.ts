import type { SupabaseClient } from '@supabase/supabase-js';
import type { Task, TaskPriority, TaskStatus, TaskType } from '@/lib/domain/types';
import { mapTask, type TaskRow } from '@/lib/domain/mappers';

export interface TaskPatch {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  taskType?: TaskType;
  products?: string[];
  milestoneId?: string | null;
  schoolId?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  position?: number;
}

export interface TaskCreate {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  taskType?: TaskType;
  products?: string[];
  milestoneId?: string | null;
  schoolId?: string | null;
  assigneeId?: string | null;
  reporterId?: string | null;
  dueDate?: string | null;
  position?: number;
  externalId?: string | null;
  externalSource?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

/**
 * 任务数据访问层。
 * 所有更新都走乐观锁：调用方必须传入 expectedVersion，
 * DB 中 version 不匹配时抛出 ConflictError（HTTP 409）。
 */
export class TaskService {
  constructor(private readonly db: SupabaseClient) {}

  async listByProject(projectId: string): Promise<Task[]> {
    const { data, error } = await this.db
      .from('tasks')
      .select('*')
      .eq('project_id', projectId)
      .neq('status', 'done')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const { data: done, error: doneErr } = await this.db
      .from('tasks')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'done')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (doneErr) throw doneErr;

    return [...((data as TaskRow[]) ?? []), ...((done as TaskRow[]) ?? [])].map(mapTask);
  }

  async getById(taskId: string): Promise<Task | null> {
    const { data, error } = await this.db
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTask(data as TaskRow) : null;
  }

  async create(projectId: string, input: TaskCreate): Promise<Task> {
    const status = input.status ?? 'todo';
    const pos = input.position ?? (await this.nextPosition(projectId, status));
    const { data, error } = await this.db
      .from('tasks')
      .insert({
        project_id: projectId,
        milestone_id: input.milestoneId ?? null,
        school_id: input.schoolId ?? null,
        title: input.title,
        description: input.description ?? null,
        status,
        priority: input.priority ?? 'p2',
        task_type: input.taskType ?? 'general',
        products: input.products ?? [],
        assignee_id: input.assigneeId ?? null,
        reporter_id: input.reporterId ?? null,
        due_date: input.dueDate ?? null,
        position: pos,
        external_id: input.externalId ?? null,
        external_source: input.externalSource ?? null,
        source_type: input.sourceType ?? null,
        source_id: input.sourceId ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return mapTask(data as TaskRow);
  }

  async update(taskId: string, patch: TaskPatch, expectedVersion: number): Promise<Task> {
    const { data: current, error: getErr } = await this.db
      .from('tasks')
      .select('version')
      .eq('id', taskId)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!current) throw new TaskNotFoundError(taskId);
    if ((current as { version: number }).version !== expectedVersion) {
      throw new ConflictError(
        `任务已被他人修改（本地 v${expectedVersion}，服务端 v${(current as { version: number }).version}），请刷新后重试`,
      );
    }

    const row: Record<string, unknown> = { version: expectedVersion + 1 };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.priority !== undefined) row.priority = patch.priority;
    if (patch.taskType !== undefined) row.task_type = patch.taskType;
    if (patch.products !== undefined) row.products = patch.products;
    if (patch.milestoneId !== undefined) row.milestone_id = patch.milestoneId;
    if (patch.schoolId !== undefined) row.school_id = patch.schoolId;
    if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId;
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
    if (patch.position !== undefined) row.position = patch.position;

    const { data, error } = await this.db
      .from('tasks')
      .update(row)
      .eq('id', taskId)
      .eq('version', expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: latest } = await this.db
        .from('tasks')
        .select('version')
        .eq('id', taskId)
        .maybeSingle();
      throw new ConflictError(
        `任务已被他人修改（本地 v${expectedVersion}，服务端 v${(latest as { version: number } | null)?.version ?? '?'}），请刷新后重试`,
      );
    }
    return mapTask(data as TaskRow);
  }

  async remove(taskId: string): Promise<void> {
    const { error } = await this.db.from('tasks').delete().eq('id', taskId);
    if (error) throw error;
  }

  async findByExternalId(
    projectId: string,
    source: string,
    externalId: string,
  ): Promise<Task | null> {
    const { data, error } = await this.db
      .from('tasks')
      .select('*')
      .eq('project_id', projectId)
      .eq('external_source', source)
      .eq('external_id', externalId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapTask(data as TaskRow) : null;
  }

  private async nextPosition(projectId: string, status: TaskStatus): Promise<number> {
    const { data } = await this.db
      .from('tasks')
      .select('position')
      .eq('project_id', projectId)
      .eq('status', status)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    return ((data as { position: number } | null)?.position ?? 0) + 1;
  }
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`任务不存在：${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
