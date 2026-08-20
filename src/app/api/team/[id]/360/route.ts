import { NextRequest } from 'next/server';

import { fail, ok, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { Person360Service } from '@/lib/domain/person-360-service';

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;

    const { id } = await ctx.params;
    const view = await Person360Service.get(id);
    if (!view) return fail('not_found', '团队成员不存在', 404);
    return ok(view);
  });
}
