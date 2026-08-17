import { NextRequest } from 'next/server';
import { withApi, ok, fail } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { TripService } from '@/lib/domain/trip-service';

/** GET /api/trips/:id */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const service = new TripService(getAdminSupabase());
    const trip = await service.getById(id);
    if (!trip) return fail('not_found', '外出申请不存在', 404);
    return ok(trip);
  });
}
