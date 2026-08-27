import { NextRequest } from "next/server";
import { fail, ok, withApi } from "@/lib/domain/http";
import { requireUser } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";
import type { BiddingFollowupStatus } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: BiddingFollowupStatus[] = ["todo", "in_progress", "done", "cancelled"];

/**
 * PATCH /api/bidding-screenshots/followup-tasks/[taskId]
 * body: { status?, resolutionNote? }
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ taskId: string }> },
) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ("status" in auth) return auth;
    const { taskId } = await ctx.params;

    const body = (await request.json().catch(() => ({}))) as {
      status?: unknown;
      resolutionNote?: unknown;
    };
    const patch: { status?: BiddingFollowupStatus; resolutionNote?: string | null } = {};
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !STATUSES.includes(body.status as BiddingFollowupStatus)) {
        return fail("invalid_param", "status 非法", 400);
      }
      patch.status = body.status as BiddingFollowupStatus;
    }
    if (body.resolutionNote !== undefined) {
      patch.resolutionNote =
        typeof body.resolutionNote === "string" ? body.resolutionNote.slice(0, 2000) : null;
    }
    const task = await BiddingDocumentService.updateFollowupTask(taskId, patch);
    return ok({ task });
  });
}
