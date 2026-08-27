import { NextRequest } from "next/server";
import { fail, ok, withApi } from "@/lib/domain/http";
import { requireUser } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";
import type { BiddingScoreItemStatus } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUS: BiddingScoreItemStatus[] = [
  "matched",
  "pending",
  "task_created",
  "uploaded",
  "na",
];

/**
 * PATCH /api/bidding-screenshots/[id]/score-items/[itemId]
 * body: { matchStatus?, deliveryAssetId?, deliveryNote? }
 */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ("status" in auth) return auth;
    const { itemId } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      matchStatus?: unknown;
      deliveryAssetId?: unknown;
      deliveryNote?: unknown;
    };

    const patch: {
      matchStatus?: BiddingScoreItemStatus;
      deliveryAssetId?: string | null;
      deliveryNote?: string | null;
    } = {};
    if (body.matchStatus !== undefined) {
      if (typeof body.matchStatus !== "string" || !ALLOWED_STATUS.includes(body.matchStatus as BiddingScoreItemStatus)) {
        return fail("invalid_param", "matchStatus 非法", 400);
      }
      patch.matchStatus = body.matchStatus as BiddingScoreItemStatus;
    }
    if (body.deliveryAssetId !== undefined) {
      patch.deliveryAssetId =
        typeof body.deliveryAssetId === "string" && body.deliveryAssetId
          ? body.deliveryAssetId
          : null;
      if (patch.deliveryAssetId) patch.matchStatus = "uploaded";
    }
    if (body.deliveryNote !== undefined) {
      patch.deliveryNote = typeof body.deliveryNote === "string" ? body.deliveryNote.slice(0, 2000) : null;
    }

    const updated = await BiddingDocumentService.updateScoreItem(itemId, patch);
    return ok({ item: updated });
  });
}
