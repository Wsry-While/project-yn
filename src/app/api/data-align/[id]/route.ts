import { NextRequest } from 'next/server';

import { fail, ok, readJson, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { DataAlignService, type AlignStatus } from '@/lib/domain/data-align-service';

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;

    const body = await readJson<{ status?: unknown; note?: unknown }>(request);
    const { id } = await ctx.params;
    if (body.status !== 'pending' && body.status !== 'resolved' && body.status !== 'ignored') {
      return fail('invalid_param', 'status 必须是 pending/resolved/ignored', 422);
    }
    const updated = await DataAlignService.updateStatus(
      id,
      body.status as AlignStatus,
      typeof body.note === 'string' ? body.note : null,
      auth.user,
    );
    if (!updated) return fail('not_found', '对齐记录不存在', 404);
    return ok(updated);
  });
}
