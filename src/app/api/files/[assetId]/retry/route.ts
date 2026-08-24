import { NextRequest, NextResponse } from 'next/server';
import { withApi, fail, ok } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { retryAssetTransfer } from '@/lib/domain/asset-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ assetId: string }> };

/**
 * 重新转存失败/待处理的附件。同步执行（小文件通常几秒内完成）。
 * body 可选 { externalId?, field? } 用于生成存储路径；不传则用 objectId/retry。
 */
export async function POST(request: NextRequest, context: RouteContext) {
  return withApi(async () => {
    const { assetId } = await context.params;
    const session = await requireUser(request);
    if (session instanceof NextResponse) return session;

    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return fail('invalid_param', '附件 ID 非法', 400);
    }

    let body: { externalId?: string; field?: string } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // 无 body 也允许
    }

    const result = await retryAssetTransfer(assetId, {
      externalId: body.externalId,
      field: body.field,
    });
    if (!result.ok) {
      return ok({ ok: false, status: result.status ?? 'failed', error: result.error });
    }
    return ok({ ok: true, status: result.status });
  });
}
