import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import {
  SUPABASE_AUTH_COOKIE_NAME,
  SUPABASE_COOKIE_ENCODING,
} from '@/lib/supabase-cookie-config';
import { getSupabaseCredentials } from '@/lib/supabase-client';

interface CookieReader {
  getAll(): Array<{ name: string; value: string }>;
}

interface CookieMutation {
  name: string;
  value: string;
  options: CookieOptions;
}

/**
 * 判断是否应给 Session Cookie 打 Secure。
 *
 * 不能改用 getRealOrigin() 推断：它会优先返回 COZE_PROJECT_DOMAIN_DEFAULT 并强制补上
 * https 前缀，在实际以 http 提供服务的环境里会给 Cookie 错误地打上 Secure，浏览器直接
 * 丢弃，表现为"登录跳转成功但一刷新就退出"。
 */
function shouldUseSecureCookie(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.COZE_PROJECT_ENV === 'PROD';
}

function createBaseServerClient(
  getAll: () => Array<{ name: string; value: string }>,
  setAll: (
    cookies: CookieMutation[],
    headers: Record<string, string>,
  ) => void,
) {
  const { url, anonKey } = getSupabaseCredentials();
  return createServerClient(url, anonKey, {
    cookieEncoding: 'base64url',
    cookieOptions: {
      name: SUPABASE_AUTH_COOKIE_NAME,
      path: '/',
      sameSite: 'lax',
      secure: shouldUseSecureCookie(),
      // 浏览器端 Supabase 客户端（src/lib/supabase-browser.ts）需要读取该 Cookie
      // 才能给 Data API / Realtime / Storage 带上用户身份，故不能设为 httpOnly。
      // 代价：任意 XSS 都能读到 access_token 与 refresh_token。若业务不需要浏览器端
      // 直连 Supabase，应改为 httpOnly: true 并把数据访问全部收敛到服务端。
      httpOnly: false,
    },
    cookies: {
      encode: SUPABASE_COOKIE_ENCODING,
      getAll,
      setAll,
    },
  });
}

function applyCookie(response: NextResponse, cookie: CookieMutation): void {
  response.cookies.set(cookie.name, cookie.value, cookie.options);
}

function getSingleCookieMutation(cookies: CookieMutation[]): CookieMutation | null {
  if (cookies.length > 1) {
    throw new Error(
      'Supabase Session 超出单 Cookie 限制；Coze 网关不支持多个 Set-Cookie，请继续精简 JWT metadata',
    );
  }
  return cookies[0] ?? null;
}

export function createSupabaseRouteClient(request: NextRequest) {
  let pendingCookie: CookieMutation | null = null;
  const pendingHeaders = new Map<string, string>();
  const supabase = createBaseServerClient(
    () => request.cookies.getAll(),
    (cookies, headers) => {
      const cookie = getSingleCookieMutation(cookies);
      if (cookie) {
        if (pendingCookie && pendingCookie.name !== cookie.name) {
          throw new Error('同一响应不能写入多个 Supabase Cookie');
        }
        pendingCookie = cookie;
      }
      for (const [name, value] of Object.entries(headers)) pendingHeaders.set(name, value);
    },
  );

  return {
    supabase,
    applyToResponse(response: NextResponse): NextResponse {
      if (pendingCookie) applyCookie(response, pendingCookie);
      for (const [name, value] of pendingHeaders) response.headers.set(name, value);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    },
  };
}

export function createReadOnlySupabaseClient(cookies: CookieReader) {
  return createBaseServerClient(
    () => cookies.getAll(),
    () => {
      // Server Components cannot mutate cookies. src/proxy.ts refreshes them first.
    },
  );
}

export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  let responseCookieName: string | null = null;
  const supabase = createBaseServerClient(
    () => request.cookies.getAll(),
    (cookies, headers) => {
      const cookie = getSingleCookieMutation(cookies);
      if (cookie) {
        if (responseCookieName && responseCookieName !== cookie.name) {
          throw new Error('同一响应不能写入多个 Supabase Cookie');
        }
        responseCookieName = cookie.name;
        request.cookies.set(cookie.name, cookie.value);
      }
      response = NextResponse.next({ request });
      if (cookie) applyCookie(response, cookie);
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    },
  );

  await supabase.auth.getClaims();
  return response;
}
