import { NextRequest, NextResponse } from 'next/server';
import { withApi, fail } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { resolveChaoxingDirectByObjectId } from '@/lib/domain/asset-access';
import { ChaoxingFileError } from '@/lib/domain/chaoxing/file-tool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 按超星 objectId 实时换取临时签名直链，并 307 跳转。
 *
 * 用于历史数据里「只有 objectId、未转存、没有 assetId」的附件，让用户当下
 * 就能预览/下载。签名现换现下、不缓存。query:
 * - objectId：32 位 hex（必填）
 * - download：=1 时附 Content-Disposition 由浏览器下载（受跨域/签名地址限制，
 *   实际文件名以超星返回为准）；默认 inline 跳转用于预览。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const session = await requireUser(request);
    if (session instanceof NextResponse) return session;

    const { searchParams } = new URL(request.url);
    const objectId = (searchParams.get('objectId') || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(objectId)) {
      return fail('invalid_param', 'objectId 非法', 400);
    }

    try {
      const { signedUrl } = await resolveChaoxingDirectByObjectId(objectId);
      return NextResponse.redirect(signedUrl, {
        status: 307,
        headers: {
          'Cache-Control': 'no-store',
          // 超星直链可能是 http://，https -> http 降级时 origin 策略保证仍发送我方 origin。
          'Referrer-Policy': 'origin',
        },
      });
    } catch (err) {
      if (err instanceof ChaoxingFileError) {
        const status = err.code === 'not_found' ? 404 : err.code === 'forbidden' ? 403 : 502;
        return fail('upstream_error', err.message, status);
      }
      const message = err instanceof Error ? err.message : '换取超星直链失败';
      return fail('upstream_error', message, 502);
    }
  });
}
