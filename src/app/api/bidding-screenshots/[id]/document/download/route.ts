import { NextRequest, NextResponse } from "next/server";
import { fail, withApi } from "@/lib/domain/http";
import { requireUser, getAdminSupabase } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";
import { BiddingScreenshotService } from "@/lib/domain/bidding-screenshot-service";
import {
  buildDocx,
  buildPdf,
  uploadGeneratedDocument,
  type DocumentPayload,
} from "@/lib/domain/bidding-document-export";
import { resolveAssetDownload } from "@/lib/domain/asset-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function rfc5987Filename(name: string): string {
  return `UTF-8''${encodeURIComponent(name)}`;
}

/**
 * GET /api/bidding-screenshots/[id]/document/download?format=docx|pdf&regenerate=1
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(request);
    if ("status" in auth) {
      return NextResponse.json(
        { success: false, error: { code: "unauthorized", message: "未登录或会话已过期" } },
        { status: 401 },
      );
    }
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

    // 命中已缓存的生成产物
    const cachedAssetId = format === "docx" ? data.docxAssetId : data.pdfAssetId;
    if (!regenerate && cachedAssetId) {
      const resolved = await resolveAssetDownload(cachedAssetId);
      if (resolved) {
        const resp = await fetch(resolved.signedUrl);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          return new NextResponse(new Uint8Array(buf), {
            status: 200,
            headers: {
              "Content-Type":
                format === "docx"
                  ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  : "application/pdf",
              "Content-Disposition": `attachment; filename="${resolved.fileName.replace(/"/g, "_")}"; filename*=${rfc5987Filename(resolved.fileName)}`,
              "Content-Length": String(buf.length),
              "Cache-Control": "private, max-age=60",
            },
          });
        }
      }
    }

    // 用 mapper 拿正确的 camelCase 记录
    const supabase = getAdminSupabase();
    const svc = new BiddingScreenshotService(supabase);
    const record = await svc.getById(id);
    if (!record) return fail("not_found", "招投标记录不存在", 404);

    const payload: DocumentPayload = {
      record,
      items: data.scoreItems,
      tasks: data.followupTasks,
      generatedAt: new Date(),
      generatedByName: data.generatedByName,
    };

    const built = format === "docx" ? await buildDocx(payload) : await buildPdf(payload);
    const contentType =
      format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf";

    let assetId: string | null = null;
    try {
      assetId = await uploadGeneratedDocument(built.buffer, built.fileName, contentType);
      await supabase
        .from("bidding_documents")
        .update(
          format === "docx"
            ? { docx_asset_id: assetId, updated_at: new Date().toISOString() }
            : { pdf_asset_id: assetId, updated_at: new Date().toISOString() },
        )
        .eq("id", data.id);
    } catch (e) {
      // 上传失败不阻断下载，仅在日志记录
      console.warn("[bidding/document/download] 缓存上传失败，直接返回文件流:", e);
    }

    return new NextResponse(new Uint8Array(built.buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${built.fileName.replace(/"/g, "_")}"; filename*=${rfc5987Filename(built.fileName)}`,
        "Content-Length": String(built.buffer.length),
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    console.error("[bidding/document/download] error:", e);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "internal_error",
          message: e instanceof Error ? e.message : "文档下载失败",
        },
      },
      { status: 500 },
    );
  }
}
