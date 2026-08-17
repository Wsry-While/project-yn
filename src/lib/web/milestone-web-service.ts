'use client';
import { apiFetch } from '@/lib/web/api-client';
import type { Milestone, TaskStatus } from '@/lib/domain/types';

export interface MilestoneCreateInput {
  projectId: string;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  position?: number;
}

export interface MilestonePatchInput {
  name?: string;
  description?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  position?: number;
}

export const milestoneWebService = {
  list(projectId: string): Promise<Milestone[]> {
    return apiFetch<Milestone[]>('/api/milestones', { query: { projectId } });
  },
  create(input: MilestoneCreateInput): Promise<Milestone> {
    return apiFetch<Milestone>('/api/milestones', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  update(id: string, patch: MilestonePatchInput): Promise<Milestone> {
    return apiFetch<Milestone>(`/api/milestones/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },
  remove(id: string): Promise<{ deleted: boolean }> {
    return apiFetch<{ deleted: boolean }>(`/api/milestones/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};
