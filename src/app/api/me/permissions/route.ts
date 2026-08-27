import { NextRequest } from 'next/server';
import { withApi, ok } from '@/lib/domain/http';
import { getAuthzService, requireUser } from '@/lib/domain/api-utils';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { ROLE_LABELS } from '@/lib/domain/rbac/types';

/**
 * GET /api/me/permissions
 * 返回当前登录用户的角色、权限码集合、是否超管、管辖团队，供前端按钮/菜单级显隐。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const authed = await requireUser(request);
    if ('status' in authed) return authed;

    const authz = getAuthzService();
    const actor = await authz.getActor(authed.user);

    // 拉取团队名（如有）
    let managedTeams: Array<{ id: string; name: string }> = [];
    if (actor.managedTeamIds.length > 0) {
      const { data } = await getAdminSupabase()
        .from('teams')
        .select('id, name')
        .in('id', actor.managedTeamIds);
      managedTeams = ((data as Array<{ id: string; name: string }> | null) ?? []);
    }

    return ok({
      userId: actor.userId,
      puid: actor.puid,
      displayName: actor.displayName,
      isSuperAdmin: actor.isSuperAdmin,
      roles: actor.roles.map((code) => ({ code, name: ROLE_LABELS[code] })),
      permissions: [...actor.permissions],
      managedTeams,
      teamMemberId: actor.teamMemberId,
    });
  });
}
