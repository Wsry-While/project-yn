import { NextRequest } from 'next/server';
import { ok, fail, withApi } from '@/lib/domain/http';
import { getAdminSupabase } from '@/lib/domain/api-utils';
import { ProjectService } from '@/lib/domain/project-service';
import { TaskService } from '@/lib/domain/task-service';
import { ActivityService } from '@/lib/domain/activity-service';
import type { TaskPriority, TaskStatus } from '@/lib/domain/types';

/**
 * 【第三方推送接口】
 * POST /api/external/push?token=xxx
 *
 * 第三方系统通过此接口主动推送项目任务 JSON。
 * 鉴权：Header `x-push-token` 或 query `token`，必须等于系统配置中的
 *       `external_push_token`（由平台注入或在 system_configs 中维护）。
 *
 * 幂等：同一 (projectId, source, externalId) 的任务只入库一次；
 *      已存在则更新 title/description/status/priority/dueDate（version 自增）。
 */
interface PushPayload {
  projectId?: string;
  source?: string;
  externalId?: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string;
  assigneeEmail?: string;
}

const VALID_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done'];
const VALID_PRIORITIES: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];

function getPushToken(): string {
  return (
    process.env.EXTERNAL_PUSH_TOKEN ||
    'dev-push-token-change-me' // 开发环境兜底；生产环境必须在环境变量中设置
  );
}

export async function POST(request: NextRequest) {
  return withApi(async () => {
    // 鉴权
    const token =
      request.headers.get('x-push-token') || request.nextUrl.searchParams.get('token');
    if (!token || token !== getPushToken()) {
      return fail('unauthorized', '推送 token 无效', 401);
    }

    const body = (await request.json().catch(() => null)) as PushPayload | PushPayload[] | null;
    if (!body) return fail('invalid_param', '请求体非法', 400);
    const items = Array.isArray(body) ? body : [body];
    if (items.length === 0 || items.length > 100) {
      return fail('invalid_param', '单次推送 1–100 条', 400);
    }

    const admin = getAdminSupabase();
    const projects = new ProjectService(admin);
    const tasks = new TaskService(admin);
    const activity = new ActivityService(admin);

    const results: Array<{ externalId: string; result: 'created' | 'updated' | 'skipped' }> = [];

    for (const item of items) {
      if (!item.projectId || !item.source || !item.externalId || !item.title) {
        results.push({ externalId: String(item.externalId ?? ''), result: 'skipped' });
        continue;
      }
      const project = await projects.getById(item.projectId);
      if (!project) {
        results.push({ externalId: item.externalId, result: 'skipped' });
        continue;
      }
      const status: TaskStatus =
        item.status && VALID_STATUSES.includes(item.status) ? item.status : 'todo';
      const priority: TaskPriority =
        item.priority && VALID_PRIORITIES.includes(item.priority) ? item.priority : 'p2';

      const existing = await tasks.findByExternalId(item.projectId, item.source, item.externalId);
      if (existing) {
        // 更新（用当前 version 做乐观锁）
        await tasks.update(
          existing.id,
          {
            title: item.title.slice(0, 200),
            description: item.description ?? null,
            status,
            priority,
            dueDate: item.dueDate ?? null,
          },
          existing.version,
        );
        results.push({ externalId: item.externalId, result: 'updated' });
      } else {
        const created = await tasks.create(item.projectId, {
          title: item.title.slice(0, 200),
          description: item.description ?? null,
          status,
          priority,
          dueDate: item.dueDate ?? null,
          externalId: item.externalId,
          externalSource: item.source,
        });
        await activity.record({
          projectId: item.projectId,
          actorName: `external:${item.source}`,
          action: 'task.external_push',
          entityType: 'task',
          entityId: created.id,
          entityTitle: created.title,
          payload: { source: item.source, externalId: item.externalId },
          ip: request.headers.get('x-forwarded-for') ?? null,
        });
        results.push({ externalId: item.externalId, result: 'created' });
      }
    }

    return ok({ received: items.length, results });
  });
}
