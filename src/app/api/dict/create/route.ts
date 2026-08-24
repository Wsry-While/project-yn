import { NextRequest } from 'next/server';

import { ok, fail, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { DictService } from '@/lib/domain/dict-service';

/** 新增一条字典值。 */
export async function POST(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(req);
    if ('status' in auth) return auth;

    const body = (await req.json()) as {
      category?: unknown;
      value?: unknown;
      aliases?: unknown;
      sortOrder?: unknown;
    };
    if (typeof body.category !== 'string' || typeof body.value !== 'string') {
      return fail('invalid_param', 'category 和 value 必填', 400);
    }
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.filter((a): a is string => typeof a === 'string')
      : [];
    const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : undefined;

    const svc = new DictService(getAdminSupabase());
    const created = await svc.create({
      category: body.category,
      value: body.value,
      aliases,
      sortOrder,
    });
    return ok(created);
  });
}
