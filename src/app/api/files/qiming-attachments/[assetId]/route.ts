import { NextRequest, NextResponse } from 'next/server';
import { withApi, fail } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { getQimingAssetSignedUrl } from '@/lib/domain/qiming-construction-attachment-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ assetId: string }> };

export function GET(request: NextRequest, context: Ctx) {
  return withApi(async () => {
    const { assetId } = await context.params;
    const session = await requireUser(request);
    if (session instanceof NextResponse) return session;
    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) {
      return fail('invalid_param', '附件 ID 非法', 400);
    }
    const result = await getQimingAssetSignedUrl(assetId);
    if (!result) return fail('not_found', '附件尚未转存完成或不存在', 404);
    return NextResponse.redirect(result.signedUrl, { status: 307, headers: { 'Cache-Control': 'no-store' } });
  });
}
