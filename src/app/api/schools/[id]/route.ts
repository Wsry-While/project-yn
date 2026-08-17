import { NextRequest } from 'next/server';
import { withApi, ok, fail } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { SchoolService } from '@/lib/domain/school-service';

/** GET /api/schools/:id */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const service = new SchoolService(getAdminSupabase());
    const data = await service.getById(id);
    if (!data) return fail('not_found', '学校不存在', 404);
    return ok(data);
  });
}
