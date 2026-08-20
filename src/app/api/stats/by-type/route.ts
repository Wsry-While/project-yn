import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { StatsService } from '@/lib/domain/stats-service';

/** GET /api/stats/by-type?projectId=xxx */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) return fail('invalid_param', 'projectId 必填', 400);
    const admin = getAdminSupabase();
    const data = await new StatsService(admin).byType(projectId);
    return ok(data);
  });
}
