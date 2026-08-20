import { NextRequest } from 'next/server';

import { ok, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import {
  AnalyticsService,
  type AnalyticsDimension,
  type AnalyticsMetric,
} from '@/lib/domain/analytics-service';

export async function GET(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(req);
    if ('status' in auth) return auth;
    const url = new URL(req.url);
    const dimension = (url.searchParams.get('dimension') as AnalyticsDimension) || 'school';
    const metric = (url.searchParams.get('metric') as AnalyticsMetric) || 'volume';
    const limit = url.searchParams.get('limit');
    const data = await AnalyticsService.dimension({
      dimension,
      metric,
      limit: limit ? Number(limit) : 15,
    });
    return ok(data);
  });
}
