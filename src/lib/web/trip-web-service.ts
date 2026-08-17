'use client';
import { apiFetch } from '@/lib/web/api-client';
import type { TripRequest } from '@/lib/domain/types';

export interface TripListFilter {
  schoolId?: string;
  projectId?: string;
  supportType?: string;
  year?: number;
  from?: string;
  to?: string;
  limit?: number;
}

export const tripWebService = {
  list(filter: TripListFilter = {}): Promise<TripRequest[]> {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') query[k] = String(v);
    }
    return apiFetch<TripRequest[]>('/api/trips', { query });
  },
  create(input: Partial<TripRequest> & { schoolName: string; supportType: string; tripDate: string; detail: string }): Promise<TripRequest> {
    return apiFetch<TripRequest>('/api/trips', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
