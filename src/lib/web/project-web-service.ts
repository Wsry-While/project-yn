'use client';
import { apiFetch } from '@/lib/web/api-client';
import type {
  Project,
  Member,
  ActivityLog,
  ProjectSettings,
  ProjectType,
} from '@/lib/domain/types';

export interface DashboardStats {
  totals: Record<TaskStatus, number>;
  total: number;
  doneRatio: number;
  upcoming: import('@/lib/domain/types').Task[];
  overdue: import('@/lib/domain/types').Task[];
}

type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';

export const projectWebService = {
  list(): Promise<Project[]> {
    return apiFetch<Project[]>('/api/projects');
  },
  get(id: string): Promise<Project> {
    return apiFetch<Project>(`/api/projects/${encodeURIComponent(id)}`);
  },
  update(
    id: string,
    patch: Partial<{
      name: string;
      description: string | null;
      startDate: string | null;
      endDate: string | null;
      projectType: ProjectType;
      schoolId: string | null;
      departmentId: string | null;
      industry: string | null;
      products: string[];
      settings: ProjectSettings;
    }>,
  ): Promise<Project> {
    return apiFetch<Project>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },
  remove(id: string): Promise<{ deleted: boolean }> {
    return apiFetch<{ deleted: boolean }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
  team(projectId: string): Promise<Member[]> {
    return apiFetch<Member[]>('/api/team', { query: { projectId } });
  },
  activity(projectId: string, limit = 30): Promise<ActivityLog[]> {
    return apiFetch<ActivityLog[]>('/api/activity', { query: { projectId, limit } });
  },
  stats(projectId: string): Promise<DashboardStats> {
    return apiFetch<DashboardStats>('/api/stats/dashboard', { query: { projectId } });
  },
};
