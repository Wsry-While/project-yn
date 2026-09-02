import { NextRequest } from 'next/server';
import { withApi } from '@/lib/domain/http';
import { requireActor } from '@/lib/domain/api-utils';
import {
  ScreenshotGuideService,
  getSavedGuide,
  getSavedSelections,
  upsertSavedGuide,
  saveGuideSelections,
  type GuideItem,
  type GuideSelections,
} from '@/lib/domain/screenshot-guide-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function actorOf(authed: { user: { id: string; displayName?: string | null } }) {
  return { id: authed.user.id, displayName: authed.user.displayName ?? null };
}

/** 从生成结果 + 历史决策汇总待持久化的 item_selections */
function buildSelections(items: GuideItem[], prev: GuideSelections): GuideSelections {
  const out: GuideSelections = {};
  for (const it of items) {
    out[it.itemId] = {
      status: it.status,
      selectedAssetIds: it.selectedAssetIds,
      // 仅保留用户手工编辑过的说明，避免重算时 AI 新说明被旧文本覆盖
      ...(prev[it.itemId]?.instructionOverride != null
        ? { instructionOverride: it.instruction }
        : {}),
    };
  }
  return out;
}

/**
 * GET /api/bidding-screenshots/:id/screenshot-guide
 * 二次进入：若已生成过则直接复用上次结果（含勾选/状态/说明），不再跑 LLM。
 * 返回 { saved:false } 表示需要首次生成；{ saved:true, guide } 为已保存指导书。
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withApi(async () => {
    const authed = await requireActor(_request);
    if ('status' in authed) return authed;
    const { id } = await ctx.params;
    const guide = await getSavedGuide(id);
    if (!guide) return Response.json({ success: true, data: { saved: false } });
    return Response.json({ success: true, data: { saved: true, guide } });
  });
}

/**
 * POST /api/bidding-screenshots/:id/screenshot-guide?force=1
 * 首次生成 / 「重新匹配知识库」。SSE 推送 step/done/error；完成后落库 screenshot_guides。
 * - 不带 force：由前端先 GET 判断，通常不会走到；若走到也按生成处理。
 * - force=1：重新召回 + 重新生成说明，但保留上次人工勾选/状态/手工说明。
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withApi(async () => {
    const authed = await requireActor(request);
    if ('status' in authed) return authed;

    const { id } = await ctx.params;
    const force = new URL(request.url).searchParams.get('force') === '1';
    const actor = actorOf(authed);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          // 重新匹配时读历史人工决策与历史参考来源（人工搜索加入的图），生成后合并保留
          const prevSelections = force ? await getSavedSelections(id) : {};
          const prevGuide = force ? await getSavedGuide(id) : null;
          const guide = await ScreenshotGuideService.generate(
            id,
            (step, detail, percent) => send({ type: 'step', step, detail, percent }),
            { prevSelections, prevGuide },
          );
          // 落库：机器结果 + 人工决策（默认勾选/状态；重算时保留历史手工说明）
          await upsertSavedGuide(id, guide, buildSelections(guide.items, prevSelections), actor);
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

/**
 * PUT /api/bidding-screenshots/:id/screenshot-guide
 * 自动保存人工决策（跨组勾选/状态/手工说明）。Body: { selections: GuideSelections }。
 * 后端按候选池清洗（剔除失效 assetId）后写回 item_selections。
 */
export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  return withApi(async () => {
    const authed = await requireActor(request);
    if ('status' in authed) return authed;
    const { id } = await ctx.params;

    let body: { selections?: GuideSelections };
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { success: false, error: { code: 'invalid_param', message: '请求体不是合法 JSON' } },
        { status: 400 },
      );
    }
    const selections = body?.selections;
    if (!selections || typeof selections !== 'object') {
      return Response.json(
        { success: false, error: { code: 'invalid_param', message: '缺少 selections' } },
        { status: 400 },
      );
    }

    await saveGuideSelections(id, selections, actorOf(authed));
    return Response.json({ success: true, data: { ok: true } });
  });
}
