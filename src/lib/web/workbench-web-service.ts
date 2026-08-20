'use client';
import { apiFetch } from '@/lib/web/api-client';
import type { MyWorkbench } from '@/lib/domain/workbench-service';

export const workbenchWebService = {
  mine(): Promise<MyWorkbench> {
    return apiFetch<MyWorkbench>('/api/stats/my-workbench');
  },
};

export type { MyWorkbench, WorkbenchItem, WorkbenchSource, WorkbenchBucket } from '@/lib/domain/workbench-service';
