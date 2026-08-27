import { NextRequest } from "next/server";
import { ok, withApi } from "@/lib/domain/http";
import { requireUser } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bidding-screenshots/team/options
 * 返回内部团队成员（供督办任务指派）
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ("status" in auth) return auth;
    const members = await BiddingDocumentService.listTeamMembers();
    return ok({ members });
  });
}
