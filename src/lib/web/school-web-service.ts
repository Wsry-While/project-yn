'use client';
import { apiFetch } from '@/lib/web/api-client';
import type { SchoolWithDepartments } from '@/lib/domain/types';

export const schoolWebService = {
  list(params?: { search?: string; salesOwner?: string; limit?: number }): Promise<SchoolWithDepartments[]> {
    const query: Record<string, string> = {};
    if (params?.search) query.search = params.search;
    if (params?.salesOwner) query.salesOwner = params.salesOwner;
    if (params?.limit) query.limit = String(params.limit);
    return apiFetch<SchoolWithDepartments[]>('/api/schools', { query });
  },
  get(id: string): Promise<SchoolWithDepartments> {
    return apiFetch<SchoolWithDepartments>(`/api/schools/${encodeURIComponent(id)}`);
  },
};
