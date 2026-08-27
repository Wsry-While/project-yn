/**
 * RBAC 类型定义与常量。
 * 三级角色：super_admin / team_leader / team_member。
 * 权限点统一使用 'module:action' 字符串，见 PermissionCode。
 */

export type RoleCode = 'super_admin' | 'team_leader' | 'team_member';

/** 与 scripts/sql/202608_rbac.sql 种子保持一致的权限点。 */
export type PermissionCode =
  | 'dashboard:view'
  | 'workbench:view'
  | 'risk:view'
  | 'analytics:view'
  | 'report:generate'
  | 'data-align:list'
  | 'data-align:resolve'
  | 'dict:list'
  | 'dict:manage'
  | 'team:list'
  | 'team:manage'
  | 'school:list'
  | 'school:create'
  | 'school:update'
  | 'school:delete'
  | 'project:list'
  | 'project:create'
  | 'project:update'
  | 'project:delete'
  | 'task:list'
  | 'task:create'
  | 'task:update'
  | 'task:delete'
  | 'milestone:create'
  | 'milestone:update'
  | 'milestone:delete'
  | 'trip:list'
  | 'trip:export'
  | 'trip:edit'
  | 'bidding:list'
  | 'bidding:export'
  | 'bidding:edit'
  | 'demand:list'
  | 'demand:edit'
  | 'qiming:list'
  | 'qiming:edit'
  | 'user:manage'
  | 'role:manage'
  | 'permission:manage'
  | 'setting:manage';

export interface RoleRecord {
  id: string;
  code: RoleCode;
  name: string;
  description: string | null;
  isBuiltin: boolean;
}

export interface PermissionRecord {
  id: string;
  code: PermissionCode;
  name: string;
  module: string;
  action: string;
  description: string | null;
}

export interface ActorContext {
  /** Supabase auth user id。 */
  userId: string;
  /** 超星 puid（可能为空，如开发库未登录建档）。 */
  puid: string | null;
  displayName: string;
  roles: RoleCode[];
  permissions: Set<PermissionCode>;
  isSuperAdmin: boolean;
  /** 团队负责人管辖的 team_id 列表。 */
  managedTeamIds: string[];
  /** 当前用户对应的 team_members.id（可空）。 */
  teamMemberId: string | null;
}

export const SUPER_ADMIN = 'super_admin' as const;
export const TEAM_LEADER = 'team_leader' as const;
export const TEAM_MEMBER = 'team_member' as const;

/** 内置角色展示顺序。 */
export const ROLE_LABELS: Record<RoleCode, string> = {
  super_admin: '超级管理员',
  team_leader: '团队负责人',
  team_member: '团队成员',
};

/**
 * 读取环境变量中配置的超管 puid 白名单（逗号分隔）。
 * 命中者在不查 app_user_roles 的情况下也视为 super_admin，便于跨环境初始化。
 */
export function getSuperAdminPuids(): string[] {
  return (process.env.SUPERADMIN_PUIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
