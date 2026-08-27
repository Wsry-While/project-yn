import { NextRequest } from "next/server";
import { ok, withApi } from "@/lib/domain/http";
import { requireUser } from "@/lib/domain/api-utils";
import { getAdminSupabase } from "@/lib/domain/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bidding-screenshots/progress?ids=a,b,c
 * 批量返回每条记录最新文档的进度摘要 { id: { total, matched, pending, task, version } }
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ("status" in auth) return auth;
    const url = new URL(request.url);
    const ids = (url.searchParams.get("ids") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (!ids.length) return ok({ progress: {} });

    const supabase = getAdminSupabase();
    const { data, error } = await supabase
      .from("bidding_documents")
      .select("record_id,version,matched_count,pending_count,task_count")
      .in("record_id", ids)
      .order("version", { ascending: false });

    if (error) return ok({ progress: {} });

    // 每个 record 只保留最新版本
    const progress: Record<
      string,
      { total: number; matched: number; pending: number; task: number; version: number }
    > = {};
    for (const row of data as Array<{
      record_id: string;
      version: number;
      matched_count: number;
      pending_count: number;
      task_count: number;
    }>) {
      if (!progress[row.record_id] || progress[row.record_id].version < row.version) {
        progress[row.record_id] = {
          version: row.version,
          matched: row.matched_count,
          pending: row.pending_count,
          task: row.task_count,
          total: row.matched_count + row.pending_count + row.task_count,
        };
      }
    }
    return ok({ progress });
  });
}
