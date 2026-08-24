import { NextRequest } from 'next/server';

import { ok, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { DictService } from '@/lib/domain/dict-service';

/**
 * 字典管理：列出所有字典项（可按 category 过滤）。
 * 仅需登录，不做额外角色校验（内部系统）。
 */
export async function GET(req: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(req);
    if ('status' in auth) return auth;

    const url = new URL(req.url);
    const category = url.searchParams.get('category') || undefined;

    const svc = new DictService(getAdminSupabase());
    const rows = await svc.adminList(category);
    return ok(rows);
  });
}
