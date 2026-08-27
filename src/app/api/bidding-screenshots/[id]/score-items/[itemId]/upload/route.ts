import { NextRequest } from "next/server";
import { fail, ok, withApi } from "@/lib/domain/http";
import { requireUser } from "@/lib/domain/api-utils";
import { getAdminSupabase } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * POST /api/bidding-screenshots/[id]/score-items/[itemId]/upload
 * multipart/form-data, field=file
 * 上传 PM 手动补充的截图到 bidding-attachments bucket，写入 external_file_assets，
 * 并把 score item 状态置为 uploaded、delivery_asset_id 指向新 asset。
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ("status" in auth) return auth;
    const { id, itemId } = await ctx.params;

    const form = await request.formData().catch(() => null);
    if (!form) return fail("invalid_param", "请求必须是 multipart/form-data", 400);
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("invalid_param", "未找到上传文件（字段名必须为 file）", 400);
    }
    if (file.size === 0) return fail("invalid_param", "文件为空", 400);
    if (file.size > MAX_BYTES) return fail("invalid_param", "截图不能超过 15 MB", 400);
    const mime = file.type || "";
    if (!ALLOWED_MIME.has(mime)) {
      return fail("invalid_param", "仅支持 PNG/JPG/GIF/WEBP/BMP 图片", 400);
    }

    const ext = (file.name.includes(".") ? file.name.split(".").pop() : mime.split("/")[1]) || "png";
    const safeExt = ext.replace(/[^\w]+/g, "").toLowerCase().slice(0, 5) || "png";
    const safeBase = (file.name.split(".").slice(0, -1).join(".") || "screenshot").replace(/[^\w.\-]+/g, "_").slice(0, 80);

    const supabase = getAdminSupabase();
    const bucket = process.env.STORAGE_BUCKET || "bidding-attachments";
    const storageKey = `score-item-uploads/${id}/${itemId}/${Date.now()}-${safeBase}.${safeExt}`;
    const arrayBuf = await file.arrayBuffer();

    const { error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(storageKey, new Blob([new Uint8Array(arrayBuf)], { type: mime }), {
        contentType: mime,
        upsert: false,
      });
    if (uploadErr) {
      console.error("[score-item/upload] storage upload failed:", uploadErr);
      return fail("internal_error", `上传到对象存储失败：${uploadErr.message}`, 500);
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("external_file_assets")
      .insert({
        source: "upload",
        object_id: storageKey,
        file_name: file.name,
        suffix: safeExt,
        content_type: mime,
        byte_size: file.size,
        status: "stored",
        bucket,
        storage_key: storageKey,
        stored_url: null,
        error_message: null,
        retry_count: 0,
      } as never)
      .select("id")
      .single();
    if (insertErr) {
      console.error("[score-item/upload] external_file_assets insert failed:", insertErr);
      return fail("internal_error", "写入附件元数据失败", 500);
    }
    const assetId = (inserted as { id: string }).id;

    // 更新评分项状态
    const item = await BiddingDocumentService.updateScoreItem(itemId, {
      matchStatus: "uploaded",
      deliveryAssetId: assetId,
      deliveryNote: `PM 于 ${new Date().toLocaleString("zh-CN")} 手动上传截图`,
    });

    // 重新统计 document 计数
    const { data: doc } = await supabase
      .from("bidding_documents")
      .select("id")
      .eq("record_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (doc) {
      const [{ count: matched }, { count: task }, { count: pending }] = await Promise.all([
        supabase
          .from("bidding_score_items")
          .select("id", { count: "exact", head: true })
          .eq("record_id", id)
          .in("match_status", ["matched", "uploaded"]),
        supabase
          .from("bidding_score_items")
          .select("id", { count: "exact", head: true })
          .eq("record_id", id)
          .eq("match_status", "task_created"),
        supabase
          .from("bidding_score_items")
          .select("id", { count: "exact", head: true })
          .eq("record_id", id)
          .eq("match_status", "pending"),
      ]);
      await supabase
        .from("bidding_documents")
        .update({
          matched_count: matched ?? 0,
          task_count: task ?? 0,
          pending_count: pending ?? 0,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", (doc as { id: string }).id);
    }

    return ok({ assetId, item });
  });
}
