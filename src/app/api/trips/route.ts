import { NextRequest } from 'next/server';
import { withApi, ok } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { TripService } from '@/lib/domain/trip-service';

/**
 * GET /api/trips?search=&supportType=&year=&limit=&offset=
 * 项目外出只读列表。项目外出数据完全由超星推送驱动，系统内不提供新建/编辑。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const p = request.nextUrl.searchParams;
    const service = new TripService(getAdminSupabase());
    const { rows, total } = await service.list({
      search: p.get('search') ?? undefined,
      supportType: p.get('supportType') ?? undefined,
      year: p.get('year') ? Number(p.get('year')) : undefined,
      sortBy: p.get('sortBy') ?? undefined,
      sortDir: p.get('sortDir') ?? undefined,
      limit: p.get('limit') ? Number(p.get('limit')) : 100,
      offset: p.get('offset') ? Number(p.get('offset')) : 0,
    });
    return ok({ rows, total });
  });
}
