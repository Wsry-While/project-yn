import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { requireUser, getAdminSupabase, requireString, cleanString } from '@/lib/domain/api-utils';
import { TaskService, type TaskCreate } from '@/lib/domain/task-service';
import { ProjectService } from '@/lib/domain/project-service';
import { ActivityService } from '@/lib/domain/activity-service';
import type { TaskPriority, TaskStatus } from '@/lib/domain/types';

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done'];
const PRIORITIES: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];

function parseStatus(value: unknown): TaskStatus | null {
  return typeof value === 'string' && (STATUSES as string[]).includes(value)
    ? (value as TaskStatus)
    : null;
}
function parsePriority(value: unknown): TaskPriority | null {
  return typeof value === 'string' && (PRIORITIES as string[]).includes(value)
    ? (value as TaskPriority)
    : null;
}

/**
 * GET /api/tasks?projectId=xxx
 */
export async function GET(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) return fail('invalid_param', 'projectId 必填', 400);
    const admin = getAdminSupabase();
    const tasks = await new TaskService(admin).listByProject(projectId);
    return ok(tasks);
  });
}

/**
 * POST /api/tasks — 创建任务
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: unknown;
      title?: unknown;
      description?: unknown;
      status?: unknown;
      priority?: unknown;
      assigneeId?: unknown;
      dueDate?: unknown;
    };
    const projectId = requireString(body.projectId, 'projectId', 100);
    const title = requireString(body.title, 'title', 200);
    const description = cleanString(body.description, 4000);
    const status = parseStatus(body.status) ?? 'todo';
    const priority = parsePriority(body.priority) ?? 'p2';
    const assigneeId =
      typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null;
    const dueDate = typeof body.dueDate === 'string' ? body.dueDate : null;

    const admin = getAdminSupabase();
    const project = await new ProjectService(admin).getById(projectId);
    if (!project) return fail('not_found', '项目不存在', 404);

    const input: TaskCreate = {
      title,
      description,
      status,
      priority,
      assigneeId,
      reporterId: auth.user.id,
      dueDate,
    };
    const created = await new TaskService(admin).create(projectId, input);

    await new ActivityService(admin).record({
      projectId,
      actorId: auth.user.id,
      actorName: auth.user.profile.displayName,
      action: 'task.create',
      entityType: 'task',
      entityId: created.id,
      entityTitle: created.title,
      payload: { status, priority },
      ip: request.headers.get('x-forwarded-for') ?? null,
    });
    return ok(created, { status: 201 });
  });
}
