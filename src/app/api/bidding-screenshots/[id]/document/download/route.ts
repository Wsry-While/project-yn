import { NextRequest } from "next/server";
import { fail, ok, withApi } from "@/lib/domain/http";
import { requireUser } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";
import {
  buildDocx,
  buildPdf,
  uploadGeneratedDocument,
  type DocumentPayload,
} from "@/lib/domain/bidding-document-export";
import { streamAssetDownload } from "@/lib/domain/asset-access";
import { getAdminSupabase } from "@/lib/domain/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/bidding-screenshots/[id]/document/download?format=docx|pdf&regenerate=1
 * 实时生成文档并下载；已生成且未改动则缓存到 bidding_documents.docx_asset_id / pdf_asset_id
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ("status" in auth) return auth;
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const format = (url.searchParams.get("format") || "docx").toLowerCase();
    if (format !== "docx" && format !== "pdf") {
      return fail("invalid_param", "format 仅支持 docx 或 pdf", 400);
    }
    const regenerate = url.searchParams.get("regenerate") === "1";

    const data = await BiddingDocumentService.getLatestDocument(id);
    if (!data || !data.scoreItems.length) {
      return fail("not_found", "请先生成交付文档", 404);
    }

    const supabase = getAdminSupabase();
    const { data: recordRow, error: recErr } = await supabase
      .from("bidding_screenshots")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (recErr || !recordRow) return fail("not_found", "招投标记录不存在", 404);
    const record = recordRow as unknown as import("@/lib/domain/types").BiddingScreenshot;

    const payload: DocumentPayload = {
      record,
      items: data.scoreItems,
      tasks: data.followupTasks,
      generatedAt: new Date(),
      generatedByName: data.generatedByName,
    };

    // 命中缓存
    const cachedAssetId = format === "docx" ? data.docxAssetId : data.pdfAssetId;
    if (!regenerate && cachedAssetId) {
      const streamed = await streamAssetDownload(cachedAssetId);
      if (streamed) return streamed.response;
    }

    const built = format === "docx" ? await buildDocx(payload) : await buildPdf(payload);
    const contentType =
      format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf";
    const assetId = await uploadGeneratedDocument(built.buffer, built.fileName, contentType);

    // 更新 bidding_documents
    await supabase
      .from("bidding_documents")
      .update(
        format === "docx"
          ? { docx_asset_id: assetId, updated_at: new Date().toISOString() }
          : { pdf_asset_id: assetId, updated_at: new Date().toISOString() },
      )
      .eq("id", data.id);

    return ok({ assetId, fileName: built.fileName, size: built.buffer.length });
  });
}
