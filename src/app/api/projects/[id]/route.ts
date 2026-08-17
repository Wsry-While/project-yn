import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase, cleanString } from '@/lib/domain/api-utils';
import { ProjectService } from '@/lib/domain/project-service';
import { ActivityService } from '@/lib/domain/activity-service';
import type { ProjectSettings } from '@/lib/domain/types';

function isProjectSettings(value: unknown): value is ProjectSettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.notifications !== 'object' || v.notifications === null) return false;
  const n = v.notifications as Record<string, unknown>;
  return ['taskAssigned', 'taskCompleted', 'projectUpdates', 'weeklyDigest'].every(
    (k) => typeof n[k] === 'boolean',
  );
}

/** GET /api/projects/:id — 项目详情 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const admin = getAdminSupabase();
    const service = new ProjectService(admin);
    const project = await service.getById(id);
    if (!project) return fail('not_found', '项目不存在', 404);
    return ok(project);
  });
}

/** PATCH /api/projects/:id — 更新项目信息 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
      startDate?: unknown;
      endDate?: unknown;
      settings?: unknown;
    };

    const admin = getAdminSupabase();
    const service = new ProjectService(admin);
    const before = await service.getById(id);
    if (!before) return fail('not_found', '项目不存在', 404);
    if (before.ownerId !== auth.user.id) {
      return fail('forbidden', '仅项目所有者可修改设置', 403);
    }

    const patch: Parameters<ProjectService['update']>[1] = {};
    if (typeof body.name === 'string') {
      const n = body.name.trim();
      if (!n || n.length > 100) return fail('invalid_param', '项目名称长度需在 1–100', 400);
      patch.name = n;
    }
    if (body.description !== undefined) {
      patch.description = cleanString(body.description, 2000);
    }
    if (typeof body.startDate === 'string' || body.startDate === null) {
      patch.startDate = body.startDate;
    }
    if (typeof body.endDate === 'string' || body.endDate === null) {
      patch.endDate = body.endDate;
    }
    if (body.settings !== undefined) {
      if (!isProjectSettings(body.settings)) {
        return fail('invalid_param', 'settings 结构非法', 400);
      }
      patch.settings = body.settings;
    }

    const updated = await service.update(id, patch);
    await new ActivityService(admin).record({
      projectId: id,
      actorId: auth.user.id,
      actorName: auth.user.profile.displayName,
      action: 'project.update',
      entityType: 'project',
      entityId: id,
      entityTitle: updated.name,
      payload: { changed: Object.keys(patch) },
      ip: request.headers.get('x-forwarded-for') ?? null,
    });
    return ok(updated);
  });
}

/** DELETE /api/projects/:id — 软删除 */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const { id } = await ctx.params;
    const admin = getAdminSupabase();
    const service = new ProjectService(admin);
    const project = await service.getById(id);
    if (!project) return fail('not_found', '项目不存在', 404);
    if (project.ownerId !== auth.user.id) {
      return fail('forbidden', '仅项目所有者可删除项目', 403);
    }
    await service.softDelete(id);
    return ok({ deleted: true });
  });
}
