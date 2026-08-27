import { NextRequest } from 'next/server';
import { withApi } from '@/lib/domain/http';
import { requireActor } from '@/lib/domain/api-utils';
import { ScreenshotGuideService } from '@/lib/domain/screenshot-guide-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/bidding-screenshots/:id/screenshot-guide
 * 基于已确认交付文档的评分项 + 截图知识库，生成「截图作业指导书」。
 * SSE 推送 step/done/error；完成后一次性下发完整 guide 结构。
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withApi(async () => {
    const authed = await requireActor(request);
    if ('status' in authed) return authed;

    const { id } = await ctx.params;
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          const guide = await ScreenshotGuideService.generate(id, (step, detail, percent) => {
            send({ type: 'step', step, detail, percent });
          });
          send({ type: 'done', guide });
        } catch (err) {
          console.error('[screenshot-guide] error:', err);
          send({
            type: 'error',
            message: err instanceof Error ? err.message : '生成截图指导书失败',
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });
}
