import { NextRequest } from 'next/server';
import { withApi } from '@/lib/domain/http';
import { requireActor } from '@/lib/domain/api-utils';
import { buildScreenshotGuideDocx } from '@/lib/domain/screenshot-guide-export';
import type { ScreenshotGuide } from '@/lib/domain/screenshot-guide-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/bidding-screenshots/:id/screenshot-guide/export
 * Body: 用户在确认界面编辑后的完整 ScreenshotGuide。
 * 实时生成 docx 并以文件流返回（不入库）。
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withApi(async () => {
    const authed = await requireActor(request);
    if ('status' in authed) return authed;
    const { id } = await ctx.params;

    let guide: ScreenshotGuide;
    try {
      guide = (await request.json()) as ScreenshotGuide;
    } catch {
      return Response.json(
        { success: false, error: { code: 'invalid_param', message: '请求体不是合法 JSON' } },
        { status: 400 },
      );
    }

    if (!guide || guide.recordId !== id || !Array.isArray(guide.items)) {
      return Response.json(
        {
          success: false,
          error: { code: 'invalid_param', message: '指导书数据不完整或记录不匹配' },
        },
        { status: 400 },
      );
    }

    const { buffer, fileName } = await buildScreenshotGuideDocx(guide);

    // 中文文件名 RFC5987 编码
    const encoded = encodeURIComponent(fileName);
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`,
        'Content-Length': String(buffer.length),
      },
    });
  });
}
