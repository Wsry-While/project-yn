import { NextRequest } from 'next/server';
import { withApi, ok, fail } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { MilestoneService } from '@/lib/domain/milestone-service';
import { TASK_STATUS_ORDER } from '@/lib/domain/types';

/** PATCH /api/milestones/:id */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Parameters<MilestoneService['update']>[1] = {};
    if (typeof body.name === 'string') patch.name = body.name;
    if (typeof body.description === 'string' || body.description === null) {
      patch.description = body.description as string | null;
    }
    if (typeof body.position === 'number') patch.position = body.position;
    if (
      typeof body.status === 'string' &&
      (TASK_STATUS_ORDER as string[]).includes(body.status)
    ) {
      patch.status = body.status as (typeof TASK_STATUS_ORDER)[number];
    }
    if (typeof body.dueDate === 'string' || body.dueDate === null) {
      patch.dueDate = body.dueDate as string | null;
    }
    const updated = await new MilestoneService(getAdminSupabase()).update(id, patch);
    return ok(updated);
  });
}

/** DELETE /api/milestones/:id */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    await new MilestoneService(getAdminSupabase()).remove(id);
    return ok({ deleted: true });
  });
}

// 让类型可达
void fail;
