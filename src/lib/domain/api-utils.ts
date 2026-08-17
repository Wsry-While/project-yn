import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseRouteClient } from '@/lib/supabase-ssr';
import { getSessionUser, type SessionUser } from '@/lib/supabase-auth';
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import { fail } from '@/lib/domain/http';

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
