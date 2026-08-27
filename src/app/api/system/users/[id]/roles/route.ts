import { NextRequest } from 'next/server';
import { withApi, ok, fail, readJson } from '@/lib/domain/http';
import { getAdminSupabase, requirePermission } from '@/lib/domain/api-utils';

interface Body {
  roleIds?: string[];
  scope?: 'all' | 'team' | 'self';
}

/**
 * PATCH /api/system/users/:id/roles
 * 覆盖式更新用户角色集合（body: { roleIds: string[], scope?: 'all'|'team'|'self' }）。
 * 超管用户的角色不允许被清空/降级（除非本人）。
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const authed = await requirePermission(request, 'user:manage');
    if ('status' in authed) return authed;

    const { id } = await ctx.params;
    const body = (await readJson<Body>(request)) ?? {};
    const roleIds = Array.isArray(body.roleIds) ? body.roleIds : [];
    const scope: 'all' | 'team' | 'self' = body.scope ?? 'self';

    const admin = getAdminSupabase();

    // 校验角色存在
    if (roleIds.length > 0) {
      const { data: roles, error: rErr } = await admin
        .from('app_roles')
        .select('id, code')
        .in('id', roleIds);
      if (rErr) throw rErr;
      if (!roles || roles.length !== roleIds.length) {
        return fail('invalid_param', '包含不存在的角色');
      }
    }

    // 不允许通过此接口把 super_admin 身份从本人身上移除（防止自锁）
    const isSelf = authed.actor.teamMemberId === id;
    if (isSelf && !roleIds.length) {
      return fail('invalid_param', '不能移除自身所有角色');
    }

    // 覆盖：先删后插（按 team_member_id）
    const { error: delErr } = await admin
      .from('app_user_roles')
      .delete()
      .eq('team_member_id', id);
    if (delErr) throw delErr;
    if (roleIds.length > 0) {
      const { error: insErr } = await admin.from('app_user_roles').insert(
        roleIds.map((rid) => ({
          team_member_id: id,
          role_id: rid,
          scope,
        })),
      );
      if (insErr) throw insErr;
    }
    return ok({ id, roleIds, scope });
  });
}
