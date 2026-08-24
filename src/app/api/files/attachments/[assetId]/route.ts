import { NextRequest, NextResponse } from 'next/server';
import { withApi, fail } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getAssetSignedUrl } from '@/lib/domain/bidding-attachment-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ assetId: string }> };

// 登录用户下载已转存附件：服务端换签名 URL 后 307 重定向到对象存储
export function GET(request: NextRequest, context: RouteContext) {
  return withApi(async () => {
    const { assetId } = await context.params;
    const session = await requireUser(request);
    if (session instanceof NextResponse) return session;

    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return fail('invalid_param', '附件 ID 非法', 400);
    }

    const result = await getAssetSignedUrl(assetId);
    if (!result) return fail('not_found', '附件尚未转存完成或不存在', 404);

    return NextResponse.redirect(result.signedUrl, {
      status: 307,
      headers: {
        'Cache-Control': 'no-store',
        // 超星直链为 http://，从 https 跳转属协议降级；默认 strict-origin-when-cross-origin
        // 会剥离 Referer 导致超星 CDN 防盗链 403。origin 策略在降级时仍发送我方 origin。
        'Referrer-Policy': 'origin',
      },
    });
  });
}
