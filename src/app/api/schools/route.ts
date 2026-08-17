import { NextRequest } from 'next/server';
import { withApi, ok } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { SchoolService } from '@/lib/domain/school-service';

/**
 * GET /api/schools?search=&salesOwner=
 * 返回学校及其部门。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const search = request.nextUrl.searchParams.get('search')?.trim() || undefined;
    const salesOwner = request.nextUrl.searchParams.get('salesOwner')?.trim() || undefined;
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? '200');
    const service = new SchoolService(getAdminSupabase());
    const data = await service.listWithDepartments({
      search,
      salesOwner,
      limit: Number.isFinite(limit) ? limit : 200,
    });
    return ok(data);
  });
}
