import { NextRequest } from 'next/server';

import { ok, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { WeeklyReportService } from '@/lib/domain/weekly-report-service';

export async function GET(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(req);
    if ('status' in auth) return auth;

    const url = new URL(req.url);
    const data = await WeeklyReportService.build({
      startDate: url.searchParams.get('startDate') || undefined,
      endDate: url.searchParams.get('endDate') || undefined,
      days: url.searchParams.get('days') ? Number(url.searchParams.get('days')) : undefined,
      salesManagerId: url.searchParams.get('salesManagerId') || undefined,
      schoolId: url.searchParams.get('schoolId') || undefined,
    });
    return ok(data);
  });
}
