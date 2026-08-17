import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase, requireString, cleanString } from '@/lib/domain/api-utils';
import { ProjectService } from '@/lib/domain/project-service';
import { ActivityService } from '@/lib/domain/activity-service';

/**
 * GET /api/projects
 * 返回当前登录用户可访问的所有项目。
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const admin = getAdminSupabase();
    const service = new ProjectService(admin);
    const projects = await service.listForUser(auth.user.id);

    // 若无项目，自动为其创建一个示例项目，保证首屏可用
    if (projects.length === 0) {
      const created = await service.create({
        name: '我的项目',
        description: '欢迎使用项目中心，可在「项目设置」中改名或删除。',
        ownerId: auth.user.id,
      });
      await new ActivityService(admin).record({
        projectId: created.id,
        actorId: auth.user.id,
        actorName: auth.user.profile.displayName,
        action: 'project.create',
        entityType: 'project',
        entityId: created.id,
        entityTitle: created.name,
        ip: request.headers.get('x-forwarded-for') ?? null,
      });
      return ok([created]);
    }
    return ok(projects);
  });
}

/**
 * POST /api/projects
 * 创建项目。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
      startDate?: unknown;
      endDate?: unknown;
    };
    const name = requireString(body.name, 'name', 100);
    const description = cleanString(body.description, 2000);
    const startDate = typeof body.startDate === 'string' ? body.startDate : null;
    const endDate = typeof body.endDate === 'string' ? body.endDate : null;

    const admin = getAdminSupabase();
    const service = new ProjectService(admin);
    const created = await service.create({
      name,
      description,
      ownerId: auth.user.id,
      startDate,
      endDate,
    });
    await new ActivityService(admin).record({
      projectId: created.id,
      actorId: auth.user.id,
      actorName: auth.user.profile.displayName,
      action: 'project.create',
      entityType: 'project',
      entityId: created.id,
      entityTitle: created.name,
      ip: request.headers.get('x-forwarded-for') ?? null,
    });
    return ok(created, { status: 201 });
  });
}

// 重新导出 fail 以保持工具类型可达
export { fail };
