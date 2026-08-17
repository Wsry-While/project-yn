import { timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { fail } from '@/lib/domain/http';

type AuthFailure = ReturnType<typeof fail>;

function readToken(request: NextRequest): string | null {
  const headerToken = request.headers.get('x-push-token')?.trim();
  if (headerToken) return headerToken;

  const queryToken = request.nextUrl.searchParams.get('token')?.trim();
  if (queryToken) return queryToken;

  const authorization = request.headers.get('authorization')?.trim();
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return null;
}

function configuredTokens(envNames: string[]): string[] {
  const tokens = envNames.flatMap((name) => {
    const value = process.env[name];
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  });

  if (tokens.length > 0) return tokens;
  if (process.env.COZE_PROJECT_ENV !== 'PROD') return ['dev-push-token-change-me'];
  return [];
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authorizePushToken(
  request: NextRequest,
  options: { envNames: string[]; scope: string },
): AuthFailure | null {
  const provided = readToken(request);
  if (!provided) {
    return fail('missing_push_token', `${options.scope}缺少访问 token`, 401);
  }

  const allowed = configuredTokens(options.envNames);
  if (allowed.length === 0) {
    console.error(`[external-push] ${options.scope}未配置推送 token`);
    return fail('push_token_not_configured', '推送 token 未配置', 500);
  }

  if (!allowed.some((token) => safeEqual(provided, token))) {
    return fail('invalid_push_token', `${options.scope}访问 token 无效`, 401);
  }

  return null;
}
