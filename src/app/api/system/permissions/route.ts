import { NextRequest } from 'next/server';
import { withApi, ok } from '@/lib/domain/http';
import { getAdminSupabase, requirePermission } from '@/lib/domain/api-utils';

/**
 * GET /api/system/permissions
 * 返回全部权限点，按 module/action 排序，供权限树展示。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const authed = await requirePermission(request, 'permission:manage');
    if ('status' in authed) return authed;

    const { data, error } = await getAdminSupabase()
      .from('app_permissions')
      .select('id, code, name, module, action, description, sort_order')
      .order('module', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return ok(data ?? []);
  });
}
