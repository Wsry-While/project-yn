import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getRealOrigin } from '@/lib/auth-utils';

const LOGIN_CONTEXT_COOKIE = 'chaoxing_login_ctx';
const LOGIN_CONTEXT_MAX_AGE = 60 * 10;

/**
 * 登录发起时的上下文，跨超星跳转把落地路径带回来。签名是为了让 nextPath
 * 只可能来自本应用发起的登录，避免被构造成任意跳转目标。
 */
interface LoginContext {
  version: 1;
  nextPath: string;
  expiresAt: number;
}

function getSigningSecret(): string {
  const secret = process.env.CHAOXING_SECRET?.trim();
  if (!secret) throw new Error('缺少 CHAOXING_SECRET');
  return secret;
}

function equal(left: string, right: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(left), hash(right));
}

function encode(context: LoginContext): string {
  const payload = Buffer.from(JSON.stringify(context)).toString('base64url');
  const signature = createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decode(value: string | undefined): LoginContext | null {
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
  if (!equal(signature, expected)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const context = parsed as Partial<LoginContext>;
    if (
      context.version !== 1 ||
      typeof context.nextPath !== 'string' ||
      typeof context.expiresAt !== 'number' ||
      context.expiresAt <= Date.now()
    ) {
      return null;
    }
    return context as LoginContext;
  } catch {
    return null;
  }
}

export function setLoginContextCookie(
  response: NextResponse,
  request: NextRequest,
  nextPath: string,
): void {
  response.cookies.set(
    LOGIN_CONTEXT_COOKIE,
    encode({
      version: 1,
      nextPath,
      expiresAt: Date.now() + LOGIN_CONTEXT_MAX_AGE * 1000,
    }),
    {
      httpOnly: true,
      secure: getRealOrigin(request).startsWith('https:'),
      sameSite: 'lax',
      path: '/',
      maxAge: LOGIN_CONTEXT_MAX_AGE,
    },
  );
}

export function readLoginContext(request: NextRequest): LoginContext | null {
  return decode(request.cookies.get(LOGIN_CONTEXT_COOKIE)?.value);
}

export function clearLoginContextCookie(response: NextResponse, request: NextRequest): void {
  response.cookies.set(LOGIN_CONTEXT_COOKIE, '', {
    httpOnly: true,
    secure: getRealOrigin(request).startsWith('https:'),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
