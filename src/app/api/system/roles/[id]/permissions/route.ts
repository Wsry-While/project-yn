import { NextRequest } from 'next/server';
import { withApi, ok } from '@/lib/domain/http';
import { getAdminSupabase, requirePermission } from '@/lib/domain/api-utils';

/**
 * GET /api/system/roles/:id/permissions
 * 返回该角色已有的权限 id 列表。
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const authed = await requirePermission(request, 'permission:manage');
    if ('status' in authed) return authed;
    const { id } = await ctx.params;
    const { data, error } = await getAdminSupabase()
      .from('app_role_permissions')
      .select('role_id, permission_id')
      .eq('role_id', id);
    if (error) throw error;
    return ok(
      (data ?? []).map((r) => ({ roleId: r.role_id, permissionId: r.permission_id })),
    );
  });
}
