import { NextRequest, NextResponse } from 'next/server';
import { withApi, fail } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { streamAssetDownload } from '@/lib/domain/asset-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ assetId: string }> };

/**
 * 登录用户下载已转存附件：服务端流式代理，统一设置正确编码的中文文件名，
 * 避免对象存储/超星直链 307 透传导致的文件名乱码。
 * 支持 ?inline=1 改为内联预览（由内容类型决定浏览器行为）。
 */
export function GET(request: NextRequest, context: RouteContext) {
  return withApi(async () => {
    const { assetId } = await context.params;
    const session = await requireUser(request);
    if (session instanceof NextResponse) return session;

    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return fail('invalid_param', '附件 ID 非法', 400);
    }

    const inline = new URL(request.url).searchParams.get('inline') === '1';
    const streamed = await streamAssetDownload(assetId, { inline });
    if (!streamed) return fail('not_found', '附件尚未转存完成或不存在', 404);
    return streamed.response;
  });
}
