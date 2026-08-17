import { NextRequest } from 'next/server';
import { withApi, ok, fail } from '@/lib/domain/http';
import { requireUser, getAdminSupabase, requireString } from '@/lib/domain/api-utils';
import { MilestoneService } from '@/lib/domain/milestone-service';
import { TASK_STATUS_ORDER } from '@/lib/domain/types';

/**
 * GET /api/milestones?projectId=
 * 列出项目里程碑
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) return fail('invalid_param', 'projectId 必填', 400);
    const data = await new MilestoneService(getAdminSupabase()).listByProject(projectId);
    return ok(data);
  });
}

/**
 * POST /api/milestones
 * 创建里程碑
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const projectId = requireString(body.projectId, 'projectId', 100);
    const name = requireString(body.name, 'name', 100);
    const status =
      typeof body.status === 'string' && (TASK_STATUS_ORDER as string[]).includes(body.status)
        ? (body.status as (typeof TASK_STATUS_ORDER)[number])
        : 'todo';
    const created = await new MilestoneService(getAdminSupabase()).create({
      projectId,
      name,
      description: typeof body.description === 'string' ? body.description : null,
      position: typeof body.position === 'number' ? body.position : 0,
      dueDate: typeof body.dueDate === 'string' ? body.dueDate : null,
      status,
    });
    return ok(created, { status: 201 });
  });
}
