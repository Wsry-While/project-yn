import { NextRequest } from "next/server";
import { fail, ok, withApi } from "@/lib/domain/http";
import { requireUser } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/bidding-screenshots/[id]/generate-document
 * SSE：解析招标文件 → LLM 抽取评分项 → 匹配截图知识库 → 生成交付文档
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ("status" in auth) return auth;
    const { id } = await ctx.params;
    if (!id) return fail("invalid_param", "id 不能为空", 400);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          await BiddingDocumentService.generateDocument(
            id,
            {
              id: auth.user.id,
              name: auth.user.profile?.displayName || auth.user.chaoxing?.name || auth.user.email || "用户",
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
    const auth = await requireUser(_request);
    if ("status" in auth) return auth;
    const { id } = await ctx.params;
    const doc = await BiddingDocumentService.getLatestDocument(id);
    return ok({ document: doc });
  });
}
