'use client';
import { apiFetch } from '@/lib/web/api-client';
import { appStore } from '@/lib/web/app-store';

/**
 * 用户操作记录模块：
 * - 每次关键操作写入本地 ring buffer（最近 100 条），便于会话内回放/调试
 * - 异步批量上报到 /api/activity，服务端落库 activity_log
 * - 上报失败静默重试一次，不阻塞主流程
 */

interface PendingActivity {
  projectId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  entityTitle?: string;
  payload?: Record<string, unknown>;
  ts: number;
}

const QUEUE_KEY = 'pc_op_queue';
const HISTORY_KEY = 'pc_op_history';
const HISTORY_LIMIT = 100;
const FLUSH_INTERVAL = 5000;

function loadQueue(): PendingActivity[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? '[]') as PendingActivity[];
  } catch {
    return [];
  }
}

function saveQueue(items: PendingActivity[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-50)));
}

let queue: PendingActivity[] = loadQueue();
let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

function ensureTimer(): void {
  if (timer || typeof window === 'undefined') return;
  timer = setInterval(flush, FLUSH_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  window.addEventListener('beforeunload', () => void flush());
}

export function logActivity(input: Omit<PendingActivity, 'ts'>): void {
  ensureTimer();
  const item: PendingActivity = { ...input, ts: Date.now() };
  queue.push(item);
  saveQueue(queue);

  // 写入本地历史
  try {
    const history = JSON.parse(
      window.localStorage.getItem(HISTORY_KEY) ?? '[]',
    ) as PendingActivity[];
    history.unshift(item);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  } catch {
    // ignore
  }

  // 关键动作立即 flush
  if (input.action.startsWith('task.') || input.action.startsWith('project.')) {
    void flush();
  }
}

export async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  saveQueue(queue);
  try {
    await Promise.all(
      batch.map((item) =>
        apiFetch('/api/activity', {
          method: 'POST',
          body: JSON.stringify({
            projectId: item.projectId,
            action: item.action,
            entityType: item.entityType,
            entityId: item.entityId,
            entityTitle: item.entityTitle,
            payload: item.payload,
          }),
        }).catch(() => {
          // 失败重新入队
          queue.unshift(item);
          saveQueue(queue);
        }),
      ),
    );
  } finally {
    flushing = false;
  }
}

/** 便捷封装：从全局 appStore 读取 projectId 上报。 */
export function logCurrentActivity(
  input: Omit<PendingActivity, 'ts' | 'projectId'> & { projectId?: string },
): void {
  const pid = input.projectId ?? appStore.get().currentProject?.id;
  if (!pid) return;
  logActivity({ ...input, projectId: pid });
}
