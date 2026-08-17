'use client';
import { apiFetch } from '@/lib/web/api-client';
import type { BiddingScreenshot } from '@/lib/domain/types';

export interface BiddingScreenshotListFilter {
  search?: string;
  completionStatus?: string;
  salesManager?: string;
  overdue?: boolean;
  limit?: number;
  offset?: number;
}

export interface BiddingScreenshotListResponse {
  rows: BiddingScreenshot[];
  total: number;
}

export const biddingScreenshotWebService = {
  list(filter: BiddingScreenshotListFilter = {}): Promise<BiddingScreenshotListResponse> {
    const query: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(filter)) {
      if (v !== undefined && v !== null && v !== '') query[k] = v;
    }
    return apiFetch<BiddingScreenshotListResponse>('/api/bidding-screenshots', { query });
  },
  get(id: string): Promise<BiddingScreenshot> {
    return apiFetch<BiddingScreenshot>(`/api/bidding-screenshots/${id}`);
  },
};
