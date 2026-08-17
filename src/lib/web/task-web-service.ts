'use client';
import { apiFetch } from '@/lib/web/api-client';
import type { Task, TaskPriority, TaskStatus, TaskType } from '@/lib/domain/types';

export interface TaskCreateInput {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  taskType?: TaskType;
  products?: string[];
  milestoneId?: string;
  schoolId?: string;
  assigneeId?: string;
  dueDate?: string;
}

export interface TaskPatchInput {
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
  version: number;
}

export const taskWebService = {
  list(projectId: string): Promise<Task[]> {
    return apiFetch<Task[]>('/api/tasks', { query: { projectId } });
  },
  create(input: TaskCreateInput): Promise<Task> {
    return apiFetch<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) });
  },
  update(taskId: string, patch: TaskPatchInput): Promise<Task> {
    return apiFetch<Task>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },
  remove(taskId: string): Promise<void> {
    return apiFetch<void>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  },
};
