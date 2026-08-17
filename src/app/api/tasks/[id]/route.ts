import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase, cleanString } from '@/lib/domain/api-utils';
import { TaskService, ConflictError, TaskNotFoundError, type TaskPatch } from '@/lib/domain/task-service';
import { ActivityService } from '@/lib/domain/activity-service';
import type { TaskPriority, TaskStatus } from '@/lib/domain/types';

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];

/**
 * PATCH /api/tasks/:id
 * Body: { ...patch, version: number }
 * 客户端必须携带当前 version 字段；服务端基于它做乐观锁。
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      description?: unknown;
      status?: unknown;
      priority?: unknown;
      assigneeId?: unknown;
      dueDate?: unknown;
      position?: unknown;
      version?: unknown;
    };

    if (typeof body.version !== 'number') {
      return fail('invalid_param', 'version 必填且必须为数字', 400);
    }
    const patch: TaskPatch = {};
    if (typeof body.title === 'string') {
      const t = body.title.trim();
      if (!t || t.length > 200) return fail('invalid_param', '标题长度 1–200', 400);
      patch.title = t;
    }
    if (body.description !== undefined) {
      patch.description = cleanString(body.description, 4000);
    }
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !STATUSES.includes(body.status as TaskStatus)) {
        return fail('invalid_param', 'status 非法', 400);
      }
      patch.status = body.status as TaskStatus;
    }
    if (body.priority !== undefined) {
      if (typeof body.priority !== 'string' || !PRIORITIES.includes(body.priority as TaskPriority)) {
        return fail('invalid_param', 'priority 非法', 400);
      }
      patch.priority = body.priority as TaskPriority;
    }
    if (body.assigneeId !== undefined) {
      patch.assigneeId =
        typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null;
    }
    if (body.dueDate !== undefined) {
      patch.dueDate = typeof body.dueDate === 'string' ? body.dueDate : null;
    }
    if (body.position !== undefined && typeof body.position === 'number') {
      patch.position = body.position;
    }

    const admin = getAdminSupabase();
    const service = new TaskService(admin);
    try {
      const updated = await service.update(id, patch, body.version);
      await new ActivityService(admin).record({
        projectId: updated.projectId,
        actorId: auth.user.id,
        actorName: auth.user.profile.displayName,
        action:
          patch.status !== undefined ? `task.move.${patch.status}` : 'task.update',
        entityType: 'task',
        entityId: updated.id,
        entityTitle: updated.title,
        payload: { fields: Object.keys(patch) },
        ip: request.headers.get('x-forwarded-for') ?? null,
      });
      return ok(updated);
    } catch (err) {
      if (err instanceof ConflictError) {
        return fail('conflict', err.message, 409);
      }
      if (err instanceof TaskNotFoundError) {
        return fail('not_found', err.message, 404);
      }
      throw err;
    }
  });
}

/** DELETE /api/tasks/:id */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const admin = getAdminSupabase();
    const service = new TaskService(admin);
    await service.remove(id);
    return ok({ deleted: true });
  });
}
