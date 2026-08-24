import { NextRequest } from 'next/server';

import { ok, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { DictService } from '@/lib/domain/dict-service';

/** 更新单条字典值（value / aliases / sortOrder / active）。 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(req);
    if ('status' in auth) return auth;

    const { id } = await ctx.params;
    const body = (await req.json()) as {
      value?: unknown;
      aliases?: unknown;
      sortOrder?: unknown;
      active?: unknown;
    };

    const patch: { value?: string; aliases?: string[]; sortOrder?: number; active?: boolean } = {};
    if (typeof body.value === 'string') patch.value = body.value;
    if (Array.isArray(body.aliases)) {
      patch.aliases = body.aliases.filter((a): a is string => typeof a === 'string');
    }
    if (typeof body.sortOrder === 'number') patch.sortOrder = body.sortOrder;
    if (typeof body.active === 'boolean') patch.active = body.active;

    const svc = new DictService(getAdminSupabase());
    const updated = await svc.updateById(id, patch);
    return ok(updated);
  });
}
