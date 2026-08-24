import { NextRequest, NextResponse } from 'next/server';
import { withApi, fail, ok } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getAssetMeta, getPreviewKind } from '@/lib/domain/asset-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ assetId: string }> };

/** 返回附件元数据（名称、大小、状态、可预览类型），供前端渲染预览/下载按钮。 */
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
    return ok({
      id: meta.id,
      fileName: meta.fileName,
      contentType: meta.contentType,
      byteSize: meta.byteSize,
      status: meta.status,
      errorMessage: meta.errorMessage,
      retryCount: meta.retryCount,
      previewKind: getPreviewKind(meta),
      previewUrl: `/api/files/preview/${meta.id}`,
      downloadUrl: `/api/files/attachments/${meta.id}`,
      retryUrl: `/api/files/${meta.id}/retry`,
    });
  });
}
