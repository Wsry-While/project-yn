import { NextRequest, NextResponse } from 'next/server';
import { withApi, fail } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getAssetMeta, getPreviewKind, resolveAssetDownload } from '@/lib/domain/asset-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ assetId: string }> };

/**
 * 在线预览：307 跳转到可内联展示的签名 URL。
 * - 图片/PDF：对象存储或超星直链本身支持 inline，浏览器可直接渲染
 * - Office：返回 415，由前端用 Office Online Viewer 兜底或提示下载
 * 未转存完成（pending/failed）返回 409，前端引导「重新获取」。
 */
export async function GET(request: NextRequest, context: RouteContext) {
  return withApi(async () => {
    const { assetId } = await context.params;
    const session = await requireUser(request);
    if (session instanceof NextResponse) return session;

    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return fail('invalid_param', '附件 ID 非法', 400);
    }

    const meta = await getAssetMeta(assetId);
    if (!meta) return fail('not_found', '附件不存在', 404);

    const kind = getPreviewKind(meta);
    if (kind === 'office') {
      return fail('unsupported_media_type', 'Office 文档请下载后查看，或使用在线预览', 415);
    }

    const resolved = await resolveAssetDownload(assetId, { asPreview: true });
    if (!resolved) {
      return fail('not_ready', `附件当前状态为 ${meta.status}，请先重新获取`, 409);
    }

    return NextResponse.redirect(resolved.signedUrl, {
      status: 307,
      headers: {
        'Cache-Control': 'no-store',
        // 超星直链为 http://，从 https 跳转会协议降级；origin 策略保证仍发送我方 origin。
        'Referrer-Policy': 'origin',
      },
    });
  });
}
