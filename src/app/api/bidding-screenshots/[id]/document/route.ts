import { NextRequest } from "next/server";
import { ok, withApi } from "@/lib/domain/http";
import { requireUser } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bidding-screenshots/[id]/document
 * 返回最新文档、评分项、督办任务
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ("status" in auth) return auth;
    const { id } = await ctx.params;
    const doc = await BiddingDocumentService.getLatestDocument(id);
    return ok({ document: doc });
  });
}
