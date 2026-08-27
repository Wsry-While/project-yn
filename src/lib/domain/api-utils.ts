import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseRouteClient } from '@/lib/supabase-ssr';
import { getSessionUser, type SessionUser } from '@/lib/supabase-auth';
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import { fail } from '@/lib/domain/http';
import { AuthorizationService } from '@/lib/domain/rbac/authorization-service';
import type { ActorContext, PermissionCode } from '@/lib/domain/rbac/types';

/**
 * 要求当前请求已登录，否则返回 401。
 * 用于 Route Handler 的第一道闸门。
 */
export async function requireUser(
  request: NextRequest,
): Promise<{ user: SessionUser } | NextResponse> {
  const session = await getSessionUser(request.cookies);
  if (!session) {
    return fail('unauthorized', '未登录或会话已过期', 401);
  }
  return { user: session.user };
}

/**
 * 要求当前用户拥有指定权限点，否则返回 403。
 * 返回 ActorContext，供后续数据范围判断使用。
 *
 * 用法：
 *   const auth = await requirePermission(request, 'school:create');
 *   if ('status' in auth) return auth;
 *   // auth.user / auth.actor 可用
 */
export async function requirePermission(
  request: NextRequest,
  permission: PermissionCode,
): Promise<{ user: SessionUser; actor: ActorContext } | NextResponse> {
  const authed = await requireUser(request);
  if ('status' in authed) return authed;

  const authz = new AuthorizationService(getSupabaseAdminClient());
  const actor = await authz.getActor(authed.user);
  if (!authz.hasPermission(actor, permission)) {
    return fail('forbidden', `无操作权限：需要 ${permission}`, 403);
  }
  return { user: authed.user, actor };
}

/**
 * 仅要求登录，并返回完整 ActorContext（含角色/权限/数据范围）。
 * 用于需要根据角色做分支判断（但不强制某权限）的接口。
 */
export async function requireActor(
  request: NextRequest,
): Promise<{ user: SessionUser; actor: ActorContext } | NextResponse> {
  const authed = await requireUser(request);
  if ('status' in authed) return authed;
  const authz = new AuthorizationService(getSupabaseAdminClient());
  const actor = await authz.getActor(authed.user);
  return { user: authed.user, actor };
}

/**
 * 带 cookie 写回的 Supabase 客户端工厂（用户态）。
 * 用于需要在响应中刷新 session 的场景。
 */
export function getUserSupabase(request: NextRequest) {
  return createSupabaseRouteClient(request);
}

/**
 * Service role 客户端，绕过 RLS，仅在服务端可信流程中使用：
 * - 内部任务的 owner 检查
 * - 第三方推送接口写入
 * 永远不要把这个客户端的 key 下发到浏览器。
 */
export function getAdminSupabase() {
  return getSupabaseAdminClient();
}

export function getAuthzService(): AuthorizationService {
  return new AuthorizationService(getSupabaseAdminClient());
}

/**
 * 简单字符串截断/清洗，避免写入超长字段把 DB 撑爆。
 */
export function cleanString(value: unknown, max = 2000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`字段 ${field} 不能为空`), { status: 400, code: 'invalid_param' });
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw Object.assign(new Error(`字段 ${field} 超长（>${max}）`), {
      status: 400,
      code: 'invalid_param',
    });
  }
  return trimmed;
}
