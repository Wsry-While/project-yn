import { NextRequest } from 'next/server';
import { withApi, ok, fail } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { BiddingScreenshotService } from '@/lib/domain/bidding-screenshot-service';

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const service = new BiddingScreenshotService(getAdminSupabase());
    const row = await service.getById(id);
    if (!row) return fail('not_found', '招投标截图记录不存在', 404);
    return ok(row);
  });
}
