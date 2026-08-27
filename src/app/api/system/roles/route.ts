import { NextRequest } from 'next/server';
import { withApi, ok } from '@/lib/domain/http';
import { getAdminSupabase, requirePermission } from '@/lib/domain/api-utils';

/**
 * GET /api/system/roles
 * 返回全部角色列表（仅 super_admin / role:manage 可见）。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const authed = await requirePermission(request, 'role:manage');
    if ('status' in authed) return authed;

    const { data, error } = await getAdminSupabase()
      .from('app_roles')
      .select('id, code, name, description, is_builtin, sort_order')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return ok(data ?? []);
  });
}
