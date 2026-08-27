import { NextRequest, NextResponse } from "next/server";
import { fail, ok, withApi } from "@/lib/domain/http";
import { requireActor } from "@/lib/domain/api-utils";
import {
  BiddingDocumentService,
  type DocumentPreview,
} from "@/lib/domain/bidding-document-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/bidding-screenshots/[id]/confirm-document
 * 人工确认预览结果后正式入库。
 * Body: { preview: DocumentPreview }
 * 二次生成覆盖（已有文档）时仅超管可确认，路由层已在 generate 阶段拦截，
 * 这里再次校验以保证幂等安全。
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const authed = await requireActor(request);
    if ("status" in authed) return authed;
    const { id } = await ctx.params;
    if (!id) return fail("invalid_param", "id 不能为空", 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail("invalid_param", "请求体不是合法 JSON", 400);
    }
    const preview = (body as { preview?: DocumentPreview } | null)?.preview;
    if (!preview || !Array.isArray(preview.items) || preview.recordId !== id) {
      return fail("invalid_param", "缺少合法的预览数据（preview）", 400);
    }

    const existing = await BiddingDocumentService.getLatestDocument(id);
    if (existing && !authed.actor.isSuperAdmin) {
      return fail("forbidden", "该项目已存在交付文档，覆盖确认仅超级管理员可操作", 403);
    }

    const doc = await BiddingDocumentService.confirmDocument(preview, {
      id: authed.user.id,
      name:
        authed.user.profile?.displayName ||
        authed.user.chaoxing?.name ||
        authed.user.email ||
        "用户",
    });
    return NextResponse.json(ok(doc));
  });
}
