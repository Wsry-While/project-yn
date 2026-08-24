import { NextRequest, NextResponse } from 'next/server';
import { withApi, fail } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getAssetMeta, streamAssetDownload } from '@/lib/domain/asset-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ assetId: string }> };

/**
 * 在线预览：服务端流式代理，以 inline 方式回传图片/PDF/音视频，
 * 以及可在浏览器内用开源库本地解析的 Office 文档（docx/xlsx/xls/csv），
 * 统一由我方设置 Content-Type/Content-Disposition，并避免 https→http 混合内容。
 * - .doc/.ppt/.pptx 等无成熟纯前端开源方案的类型由前端识别并引导下载
 * - 未转存完成（pending/failed）返回 409，前端引导「重新获取」
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

    if (meta.status !== 'stored' && meta.status !== 'direct') {
      return fail('not_ready', `附件当前状态为 ${meta.status}，请先重新获取`, 409);
    }

    // 服务端流式代理：对内联资源统一设置 inline，且保持我方 https 域名（避免直链 http 混合内容）。
    // Office（docx/xlsx 等）同样回传字节流，由前端开源库本地解析渲染。
    const streamed = await streamAssetDownload(assetId, { inline: true });
    if (!streamed) return fail('not_ready', '附件暂不可预览，请先重新获取', 409);
    return streamed.response;
  });
}
