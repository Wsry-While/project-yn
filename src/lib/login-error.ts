import { NextRequest, NextResponse } from 'next/server';
import { getRealOrigin } from '@/lib/auth-utils';
import { ChaoxingLoginError, type ChaoxingLoginErrorReason } from '@/lib/chaoxing-client';

/**
 * 在超星侧的三类失败之外，再加一类只可能发生在本应用内的：
 * - session_failed：超星已验证通过，但建立 Supabase 会话时出错
 */
export type LoginErrorReason = ChaoxingLoginErrorReason | 'session_failed';

const LOGIN_ERROR_REASONS = new Set<string>([
  'config_missing',
  'institution_mismatch',
  'oauth_failed',
  'session_failed',
]);

/** 错误页的 reason 来自查询参数，必须收敛到已知取值，避免把任意文本渲染出去。 */
export function normalizeLoginErrorReason(value: string): LoginErrorReason {
  return LOGIN_ERROR_REASONS.has(value) ? (value as LoginErrorReason) : 'oauth_failed';
}

/** 超星链路上的失败：带分类的用其分类，其余（网络、非 JSON 响应）算授权未走通。 */
export function chaoxingErrorReason(error: unknown): LoginErrorReason {
  return error instanceof ChaoxingLoginError ? error.reason : 'oauth_failed';
}

/**
 * 登录失败一律 302 到错误页，而不是返回 JSON —— 这些路由是浏览器直接跳进来的，
 * 裸 JSON 对用户没有任何可操作性。具体错误信息只留在服务端日志里。
 */
export function loginErrorRedirect(
  request: NextRequest,
  reason: LoginErrorReason,
): NextResponse {
  const url = new URL('/auth/error', getRealOrigin(request));
  url.searchParams.set('reason', reason);

  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
