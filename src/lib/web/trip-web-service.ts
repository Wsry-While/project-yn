'use client';
import { apiFetch } from '@/lib/web/api-client';
import type { TripOptionDict, TripRequest } from '@/lib/domain/types';

export interface TripListFilter {
  search?: string;
  supportType?: string;
  year?: number;
  limit?: number;
  offset?: number;
}

export interface TripListResponse {
  rows: TripRequest[];
  total: number;
}

export const tripWebService = {
  list(filter: TripListFilter = {}): Promise<TripListResponse> {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') query[k] = String(v);
    }
    return apiFetch<TripListResponse>('/api/trips', { query });
  },
  get(id: string): Promise<TripRequest> {
    return apiFetch<TripRequest>(`/api/trips/${id}`);
  },
  options(fieldKey = 'support_type'): Promise<TripOptionDict[]> {
    return apiFetch<TripOptionDict[]>('/api/trips/options', {
      query: { fieldKey },
    });
  },
};
