import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase } from '@/lib/domain/api-utils';
import { TeamService } from '@/lib/domain/team-service';
import { ProjectService } from '@/lib/domain/project-service';
import { ActivityService } from '@/lib/domain/activity-service';
import type { MemberRole } from '@/lib/domain/types';

const ROLES: MemberRole[] = ['owner', 'admin', 'member', 'viewer'];

/** GET /api/team?projectId=xxx */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) return fail('invalid_param', 'projectId 必填', 400);
    const admin = getAdminSupabase();
    const members = await new TeamService(admin).listByProject(projectId);
    return ok(members);
  });
}

/** POST /api/team — 邀请/更新成员 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: unknown;
      userId?: unknown;
      role?: unknown;
      displayName?: unknown;
      title?: unknown;
    };
    if (typeof body.projectId !== 'string' || typeof body.userId !== 'string') {
      return fail('invalid_param', 'projectId/userId 必填', 400);
    }
    if (typeof body.role !== 'string' || !ROLES.includes(body.role as MemberRole)) {
      return fail('invalid_param', 'role 非法', 400);
    }
    const admin = getAdminSupabase();
    const project = await new ProjectService(admin).getById(body.projectId);
    if (!project) return fail('not_found', '项目不存在', 404);
    if (project.ownerId !== auth.user.id) {
      return fail('forbidden', '仅项目所有者可邀请成员', 403);
    }
    const member = await new TeamService(admin).upsert({
      projectId: body.projectId,
      userId: body.userId,
      role: body.role as MemberRole,
      displayName: typeof body.displayName === 'string' ? body.displayName : null,
      title: typeof body.title === 'string' ? body.title : null,
    });
    await new ActivityService(admin).record({
      projectId: body.projectId,
      actorId: auth.user.id,
      actorName: auth.user.profile.displayName,
      action: 'member.invite',
      entityType: 'member',
      entityId: body.userId,
      entityTitle: member.displayName,
      ip: request.headers.get('x-forwarded-for') ?? null,
    });
    return ok(member, { status: 201 });
  });
}
