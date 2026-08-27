import { NextRequest } from "next/server";
import { fail, ok, withApi } from "@/lib/domain/http";
import { requireUser } from "@/lib/domain/api-utils";
import { BiddingDocumentService } from "@/lib/domain/bidding-document-service";
import type { BiddingFollowupPriority } from "@/lib/domain/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIORITIES: BiddingFollowupPriority[] = ["p0", "p1", "p2", "p3"];

function actorName(user: {
  profile?: { displayName?: string } | null;
  chaoxing?: { name?: string } | null;
  email?: string | null;
}): string {
  return user.profile?.displayName || user.chaoxing?.name || user.email || "用户";
}

/**
 * POST /api/bidding-screenshots/[id]/score-items/[itemId]/followup-task
 * body: { title, description?, priority, assigneeId?, externalAssigneeName?, ... }
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ("status" in auth) return auth;
    const { id, itemId } = await ctx.params;

    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      description?: unknown;
      priority?: unknown;
      assigneeId?: unknown;
      externalAssigneeName?: unknown;
      externalAssigneeContact?: unknown;
      externalAssigneeOrg?: unknown;
      dueDate?: unknown;
    };

    if (typeof body.title !== "string" || !body.title.trim()) {
      return fail("invalid_param", "任务标题不能为空", 400);
    }
    const priority =
      typeof body.priority === "string" && PRIORITIES.includes(body.priority as BiddingFollowupPriority)
        ? (body.priority as BiddingFollowupPriority)
        : "p2";

    const hasAssignee = typeof body.assigneeId === "string" && body.assigneeId.trim();
    const hasExternal =
      typeof body.externalAssigneeName === "string" && body.externalAssigneeName.trim();
    if (!hasAssignee && !hasExternal) {
      return fail("invalid_param", "请选择内部负责人或填写外部负责人", 400);
    }

    const task = await BiddingDocumentService.createFollowupTask({
      recordId: id,
      scoreItemId: itemId,
      title: body.title.trim().slice(0, 200),
      description: typeof body.description === "string" ? body.description.slice(0, 4000) : null,
      priority,
      assigneeId: hasAssignee ? (body.assigneeId as string) : null,
      externalAssigneeName: hasExternal ? (body.externalAssigneeName as string).trim() : null,
      externalAssigneeContact:
        typeof body.externalAssigneeContact === "string"
          ? body.externalAssigneeContact.trim().slice(0, 100)
          : null,
      externalAssigneeOrg:
        typeof body.externalAssigneeOrg === "string"
          ? body.externalAssigneeOrg.trim().slice(0, 200)
          : null,
      dueDate: typeof body.dueDate === "string" && body.dueDate ? body.dueDate : null,
      actor: { id: auth.user.id, name: actorName(auth.user) },
    });
    return ok({ task });
  });
}
