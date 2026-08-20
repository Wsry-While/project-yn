import { NextRequest } from 'next/server';

import { ok, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { AnalyticsService } from '@/lib/domain/analytics-service';

export async function GET(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(req);
    if ('status' in auth) return auth;
    const url = new URL(req.url);
    const limit = url.searchParams.get('limit');
    const data = await AnalyticsService.schoolHealth(limit ? Number(limit) : 20);
    return ok(data);
  });
}
