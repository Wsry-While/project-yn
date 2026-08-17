import { NextRequest } from 'next/server';
import { withApi, ok } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { BiddingScreenshotService } from '@/lib/domain/bidding-screenshot-service';

export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const p = request.nextUrl.searchParams;
    const service = new BiddingScreenshotService(getAdminSupabase());
    const data = await service.list({
      search: p.get('search') ?? undefined,
      completionStatus: p.get('completionStatus') ?? undefined,
      salesManager: p.get('salesManager') ?? undefined,
      overdue: p.get('overdue') === '1',
      limit: p.get('limit') ? Number(p.get('limit')) : 100,
      offset: p.get('offset') ? Number(p.get('offset')) : 0,
    });
    return ok(data);
  });
}
