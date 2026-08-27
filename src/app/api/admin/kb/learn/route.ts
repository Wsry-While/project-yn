import { NextRequest } from 'next/server';
import { withApi } from '@/lib/domain/http';
import { requireActor } from '@/lib/domain/api-utils';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { ScreenshotKnowledgeService } from '@/lib/domain/screenshot-knowledge-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

/**
 * POST /api/admin/kb/learn
 * 全库扫描历史交付图片，逐图做参数级视觉理解，沉淀截图知识库 1.0。
 * 仅超级管理员可触发；SSE 推送进度。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const authed = await requireActor(request);
    if ('status' in authed) return authed;
    if (!authed.actor.isSuperAdmin) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'forbidden', message: '仅超级管理员可触发知识库学习' },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const db = getAdminSupabase();
    const service = new ScreenshotKnowledgeService(db);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          await service.learnAll(
            {
              id: authed.user.id,
              name:
                authed.user.profile?.displayName ||
                authed.user.chaoxing?.name ||
                authed.user.email ||
                '管理员',
            },
            (type, payload) => {
              if (type === 'done') {
                send({ type: 'done', ...(payload as Record<string, unknown>) });
              } else if (type === 'delta') {
                send({ type: 'step', step: 'learn', detail: (payload as { content?: string })?.content ?? '' });
              } else if (type === 'step') {
                send({ type: 'step', step: 'scan', detail: (payload as { message?: string })?.message ?? '' });
              } else {
                send({ type, ...(payload as Record<string, unknown>) });
              }
            },
            request.headers,
          );
        } catch (err) {
          console.error('[admin/kb-learn] error:', err);
          send({
            type: 'error',
            message: err instanceof Error ? err.message : '知识库学习失败',
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

/** GET: 返回当前最新知识库版本信息 */
export async function GET() {
  return withApi(async () => {
    const db = getAdminSupabase();
    const service = new ScreenshotKnowledgeService(db);
    const latest = await service.getLatestVersion();
    return Response.json({ success: true, data: latest });
  });
}
