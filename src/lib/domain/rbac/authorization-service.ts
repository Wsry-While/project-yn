import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from '@/lib/supabase-auth';
import {
  getSuperAdminPuids,
  type ActorContext,
  type PermissionCode,
  type PermissionRecord,
  type RoleCode,
  type RoleRecord,
} from './types';

interface RoleRow {
  id: string;
  code: RoleCode;
  name: string;
  description: string | null;
  is_builtin: boolean;
}

interface PermissionRow {
  id: string;
  code: PermissionCode;
  name: string;
  module: string;
  action: string;
  description: string | null;
}

interface UserRoleRow {
  scope: 'all' | 'team' | 'self';
  team_id: string | null;
  roles: RoleRow;
}

/**
 * RBAC 授权服务。所有查询使用 admin 客户端（service role），绕过 RLS。
 * 权限判定结果缓存在单次请求内，避免重复查库。
 */
export class AuthorizationService {
  constructor(private readonly db: SupabaseClient) {}

  /**
   * 构建当前登录用户的完整授权上下文。
   * 角色来源：
   *   1. 环境变量 SUPERADMIN_PUIDS 命中 chaoxing.uid → super_admin（跨环境兜底）；
   *   2. app_user_roles 中按 auth.users.id 配置的角色。
   * 未配置任何角色的登录用户默认拥有 team_member 最小权限。
   */
  async getActor(user: SessionUser): Promise<ActorContext> {
    const puid = user.chaoxing.uid || null;
    const envSuper = puid ? getSuperAdminPuids().includes(puid) : false;

    const { data: rows, error } = await this.db
      .from('app_user_roles')
      .select('scope, team_id, team_member_id, app_roles(id, code, name, description, is_builtin)')
      .or(`user_id.eq.${user.id},team_member_id.eq.${
        // team_member_id 在下面查到后再二次查询；此处先按 user_id 查
        '00000000-0000-0000-0000-000000000000'
      }`);

    if (error) throw error;

    // 通过 auth.users.app_metadata.chaoxing.uid → team_members.puid 找到 team_member_id，
    // 再以它为键补查通过 UI 分配的角色。
    let allRows = (rows ?? []) as unknown as Array<UserRoleRow & { team_member_id?: string | null }>;
    let teamMemberId: string | null = null;
    if (puid) {
      const { data: tm } = await this.db
        .from('team_members')
        .select('id')
        .eq('puid', puid)
        .maybeSingle();
      const tmId = (tm as { id: string } | null)?.id;
      if (tmId) {
        teamMemberId = tmId;
        const { data: tmRows, error: tmErr } = await this.db
          .from('app_user_roles')
          .select('scope, team_id, team_member_id, app_roles(id, code, name, description, is_builtin)')
          .eq('team_member_id', tmId);
        if (tmErr) throw tmErr;
        const extra = (tmRows ?? []) as unknown as Array<
          UserRoleRow & { team_member_id?: string | null }
        >;
        const seen = new Set(allRows.map((r) => r.roles.id));
        for (const r of extra) if (!seen.has(r.roles.id)) allRows.push(r);
      }
    }

    const assigned = allRows;
    const roleSet = new Set<RoleCode>(assigned.map((r) => r.roles.code));
    if (envSuper) roleSet.add('super_admin');
    if (roleSet.size === 0) roleSet.add('team_member');

    const isSuperAdmin = roleSet.has('super_admin');

    // 超管拥有全部权限，直接用通配；否则查角色-权限关联。
    let permissions = new Set<PermissionCode>();
    if (isSuperAdmin) {
      const { data: allPerms } = await this.db.from('app_permissions').select('code');
      permissions = new Set<PermissionCode>(
        ((allPerms as Pick<PermissionRow, 'code'>[] | null) ?? []).map((p) => p.code),
      );
    } else {
      const { data: permRows } = await this.db
        .from('app_role_permissions')
        .select('app_permissions(code)')
        .in('role_id', assigned.map((r) => r.roles.id));
      permissions = new Set<PermissionCode>(
        (((permRows as Array<{ app_permissions: { code: PermissionCode } }> | null) ?? [])).map(
          (r) => r.app_permissions.code,
        ),
      );
    }

    const managedTeamIds = isSuperAdmin
      ? []
      : assigned
          .filter((r) => r.roles.code === 'team_leader' && r.team_id)
          .map((r) => r.team_id as string);

    return {
      userId: user.id,
      puid,
      displayName: user.chaoxing.displayName || user.chaoxing.name || user.profile.displayName,
      roles: [...roleSet],
      permissions,
      isSuperAdmin,
      managedTeamIds,
      teamMemberId,
    };
  }

  hasPermission(actor: ActorContext, code: PermissionCode): boolean {
    return actor.isSuperAdmin || actor.permissions.has(code);
  }

  /**
   * 判断当前用户能否操作某条业务记录。
   * - 超管放行全部；
   * - team_leader：记录的 sales/pm 归属成员在其管辖团队内；
   * - team_member：仅自己负责的记录可写。
   *
   * @param ownerMemberIds 记录的负责人 team_members.id 列表（销售+项目经理）。
   */
  async canWriteRecord(
    actor: ActorContext,
    ownerMemberIds: Array<string | null>,
  ): Promise<boolean> {
    if (actor.isSuperAdmin) return true;
    const owners = ownerMemberIds.filter((id): id is string => Boolean(id));
    if (owners.length === 0) return false;

    if (actor.managedTeamIds.length > 0) {
      const { data } = await this.db
        .from('team_members')
        .select('id')
        .in('id', owners)
        .in('team_id', actor.managedTeamIds);
      if ((data?.length ?? 0) > 0) return true;
    }

    if (actor.teamMemberId && owners.includes(actor.teamMemberId)) return true;
    return false;
  }

  // ---------- 系统管理查询（用于用户/角色管理页） ----------

  async listRoles(): Promise<RoleRecord[]> {
    const { data, error } = await this.db
      .from('app_roles')
      .select('id, code, name, description, is_builtin')
      .order('created_at');
    if (error) throw error;
    return ((data as RoleRow[] | null) ?? []).map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isBuiltin: r.is_builtin,
    }));
  }

  async listPermissions(): Promise<PermissionRecord[]> {
    const { data, error } = await this.db
      .from('app_permissions')
      .select('id, code, name, module, action, description')
      .order('module')
      .order('action');
    if (error) throw error;
    return ((data as PermissionRow[] | null) ?? []).map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      module: p.module,
      action: p.action,
      description: p.description,
    }));
  }

  async listRolePermissionIds(roleId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from('app_role_permissions')
      .select('permission_id')
      .eq('role_id', roleId);
    if (error) throw error;
    return ((data as Array<{ permission_id: string }> | null) ?? []).map((r) => r.permission_id);
  }
}
