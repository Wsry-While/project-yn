import { NextRequest } from 'next/server';
import { ok, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { WorkbenchService } from '@/lib/domain/workbench-service';

/** GET /api/stats/my-workbench — 当前登录用户跨四表的待办聚合 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const data = await new WorkbenchService(getAdminSupabase()).forUser(auth.user);
    return ok(data);
  });
}
