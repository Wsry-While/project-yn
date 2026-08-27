import { NextRequest, NextResponse } from "next/server";
import { fail, withApi } from "@/lib/domain/http";
import { requireActor } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/bidding-screenshots/[id]/generate-document
 * SSE：解析招标文件 → LLM 抽取评分项 → 匹配截图知识库 → 生成交付文档
 * 二次生成（已有文档时）仅超管可执行，避免覆盖 PM 已确认的结果。
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const authed = await requireActor(request);
    if ("status" in authed) return authed;
    const { id } = await ctx.params;
    if (!id) return fail("invalid_param", "id 不能为空", 400);

    // 二次生成需要超管
    const existing = await BiddingDocumentService.getLatestDocument(id);
    if (existing && !authed.actor.isSuperAdmin) {
      return fail(
        "forbidden",
        "该项目已生成过交付文档。如需重新生成，请联系超级管理员（已交付文档包含 PM 的截图/督办，重新生成会覆盖当前结果）。",
        403,
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          await BiddingDocumentService.generateDocument(
            id,
            {
              id: authed.user.id,
              name:
                authed.user.profile?.displayName ||
                authed.user.chaoxing?.name ||
                authed.user.email ||
                "用户",
            },
            (type, payload) => send({ type, ...(payload as Record<string, unknown>) }),
            request.headers,
          );
        } catch (err) {
          console.error("[bidding/generate-document] error:", err);
          send({
            type: "error",
            message: err instanceof Error ? err.message : "生成交付文档失败",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const { id } = await ctx.params;
    if (!id) return fail("invalid_param", "id 不能为空", 400);
    const data = await BiddingDocumentService.getLatestDocument(id);
    return NextResponse.json({ success: true, data });
  });
}
