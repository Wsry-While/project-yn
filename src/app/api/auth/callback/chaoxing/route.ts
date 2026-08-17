import { NextRequest, NextResponse } from 'next/server';
import { getRealOrigin } from '@/lib/auth-utils';
import { clearLoginContextCookie, readLoginContext } from '@/lib/chaoxing-login-context';
import { resolveChaoxingIdentity } from '@/lib/chaoxing-client';
import {
  chaoxingErrorReason,
  loginErrorRedirect,
  type LoginErrorReason,
} from '@/lib/login-error';
import { createSupabaseLoginToken } from '@/lib/supabase-chaoxing-user';
import { createSupabaseRouteClient } from '@/lib/supabase-ssr';

function loginError(request: NextRequest, reason: LoginErrorReason): NextResponse {
  const response = loginErrorRedirect(request, reason);
  clearLoginContextCookie(response, request);
  return response;
}

async function finishChaoxingLogin(request: NextRequest): Promise<NextResponse> {
  const search = request.nextUrl.searchParams;
  const code = search.get('code');
  // 超星把 state 用作机构 FID，即发起授权时送出的那个。下拉框模式下它就是用户
  // 选中的机构，身份必须在它下面校验通过；按钮模式下它只是轮询的起点。
  const callbackFid = search.get('state')?.trim() ?? '';
  const providerError = search.get('error_description') || search.get('error');
  if (providerError) {
    console.error('超星返回授权错误:', providerError);
    return loginError(request, 'oauth_failed');
  }

  if (!code) {
    return loginError(request, 'oauth_failed');
  }

  // 从应用主动发起登录时会有签名上下文；微服务平台直达回调时没有该 Cookie。
  const context = readLoginContext(request);

  // 分两段捕获：超星侧的失败对用户是「机构或授权的问题」，
  // Supabase 侧的失败只能是「稍后重试」，混在一起就没法区分了。
  let identity;
  try {
    identity = await resolveChaoxingIdentity(code, callbackFid);
  } catch (error) {
    console.error('解析超星身份失败:', error);
    return loginError(request, chaoxingErrorReason(error));
  }

  try {
    const tokenHash = await createSupabaseLoginToken(identity);
    const { supabase, applyToResponse } = createSupabaseRouteClient(request);
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    });
    if (error) throw error;

    const response = NextResponse.redirect(
      new URL(context?.nextPath ?? '/', getRealOrigin(request)),
    );
    // 不在此响应清除上下文 Cookie，避免与 Supabase Session 一起产生多个
    // Set-Cookie；它会在十分钟后自动过期，并且不会再参与已登录请求。
    return applyToResponse(response);
  } catch (error) {
    console.error('建立 Supabase 超星登录会话失败:', error);
    return loginError(request, 'session_failed');
  }
}

export async function GET(request: NextRequest) {
  try {
    return await finishChaoxingLogin(request);
  } catch (error) {
    console.error('处理 Supabase 超星登录回调失败:', error);
    return loginErrorRedirect(request, 'session_failed');
  }
}
