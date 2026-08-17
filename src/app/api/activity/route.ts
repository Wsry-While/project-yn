import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { ActivityService } from '@/lib/domain/activity-service';

/** GET /api/activity?projectId=xxx&limit=30 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) return fail('invalid_param', 'projectId 必填', 400);
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '30', 10) || 30, 100);
    const admin = getAdminSupabase();
    const items = await new ActivityService(admin).listByProject(projectId, limit);
    return ok(items);
  });
}

/**
 * POST /api/activity
 * 记录一条前端操作日志。主要兜底无法在服务端直接捕获的交互（点击、快捷键等）。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: unknown;
      action?: unknown;
      entityType?: unknown;
      entityId?: unknown;
      entityTitle?: unknown;
      payload?: unknown;
    };
    if (
      typeof body.projectId !== 'string' ||
      typeof body.action !== 'string' ||
      body.action.length > 80
    ) {
      return fail('invalid_param', 'projectId / action 非法', 400);
    }
    const admin = getAdminSupabase();
    await new ActivityService(admin).record({
      projectId: body.projectId,
      actorId: auth.user.id,
      actorName: auth.user.profile.displayName,
      action: body.action,
      entityType: typeof body.entityType === 'string' ? body.entityType : null,
      entityId: typeof body.entityId === 'string' ? body.entityId : null,
      entityTitle: typeof body.entityTitle === 'string' ? body.entityTitle.slice(0, 200) : null,
      payload:
        body.payload && typeof body.payload === 'object'
          ? (body.payload as Record<string, unknown>)
          : {},
      ip: request.headers.get('x-forwarded-for') ?? null,
    });
    return ok({ recorded: true });
  });
}
