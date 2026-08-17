import { NextRequest, NextResponse } from 'next/server';
import { SUPABASE_AUTH_COOKIE_NAME } from '@/lib/supabase-cookie-config';
import { createSupabaseRouteClient } from '@/lib/supabase-ssr';

export async function POST(request: NextRequest) {
  const { supabase, applyToResponse } = createSupabaseRouteClient(request);
  const response = NextResponse.json({ success: true });

  // global 会吊销该用户所有设备上的 refresh token；机房共用电脑场景下这是必要的。
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) {
    // access token 过期时吊销会失败。此时仍必须清掉本地 Cookie，
    // 否则用户会卡在"退不出去"的状态。
    console.error('全局吊销会话失败，仅清除本地 Session:', error);
    response.cookies.set(SUPABASE_AUTH_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  }

  return applyToResponse(response);
}
