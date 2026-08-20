import { NextRequest } from 'next/server';
import { withApi, ok, fail } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { School360Service } from '@/lib/domain/school-360-service';

/** GET /api/schools/:id/overview — 学校 360 聚合数据 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const data = await new School360Service(getAdminSupabase()).get(id);
    if (data.counts.trips.total + data.counts.bidding.total + data.counts.demands.total + data.counts.qiming.total === 0) {
      return ok(data);
    }
    return data ? ok(data) : fail('not_found', '学校不存在', 404);
  });
}
