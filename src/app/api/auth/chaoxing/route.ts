import { NextRequest, NextResponse } from 'next/server';
import { normalizeSafeRedirectPath } from '@/lib/auth-utils';
import { getChaoxingAuthorizationConfig } from '@/lib/chaoxing-client';
import { setLoginContextCookie } from '@/lib/chaoxing-login-context';
import { chaoxingErrorReason, loginErrorRedirect } from '@/lib/login-error';

function startChaoxingLogin(request: NextRequest, nextPath: string): NextResponse {
  const chaoxing = getChaoxingAuthorizationConfig(
    request.nextUrl.searchParams.get('fid'),
  );
  const authorizationUrl = new URL('https://auth.chaoxing.com/connect/oauth2/authorize');
  authorizationUrl.searchParams.set('appid', chaoxing.appid);
  authorizationUrl.searchParams.set('redirect_uri', chaoxing.redirectUri);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'snsapi_base');
  // 超星协议将 state 定义为用户所属机构 FID，而不是通用 OAuth 随机 state。
  // 这里送出的 FID 会由超星原样带回回调，充当轮询 CHAOXING_FIDS 的起点。
  authorizationUrl.searchParams.set('state', chaoxing.stateFid);

  const response = NextResponse.redirect(authorizationUrl);
  setLoginContextCookie(response, request, nextPath);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const nextPath = normalizeSafeRedirectPath(request.nextUrl.searchParams.get('next')) || '/';
    return startChaoxingLogin(request, nextPath);
  } catch (error) {
    console.error('发起 Supabase 超星登录失败:', error);
    return loginErrorRedirect(request, chaoxingErrorReason(error));
  }
}
