import { getAdminSupabase } from '@/lib/domain/api-utils';

export type SyncLogStatus = 'success' | 'failed' | 'skipped';

export interface SyncLogInput {
  source: string;
  direction?: 'inbound' | 'outbound';
  formId?: string;
  indexId?: string;
  externalId?: string;
  entityType: string;
  entityId?: string | null;
  op: string;
  operator?: string | null;
  ip?: string | null;
  durationMs: number;
  status: SyncLogStatus;
  message?: string | null;
  error?: string | null;
  payload?: unknown;
}

const MAX_ERROR_LENGTH = 2000;

/**
 * 写入 external_sync_logs（fire-and-forget）。
 *
 * 设计要点：
 * - 推送接口必须在业务入库后立即响应，不能因审计日志写入拖慢响应；
 * - 审计日志失败绝不允许影响业务返回；
 * - 使用 queueMicrotask 把写入推迟到当前同步代码之后，避免阻塞响应序列化；
 * - 捕获错误后只打 console.error，不抛出。
 */
export function queueSyncLog(input: SyncLogInput): void {
  queueMicrotask(async () => {
    const db = getAdminSupabase();
    try {
      const { error } = await db.from('external_sync_logs').insert({
        source: input.source,
        direction: input.direction ?? 'inbound',
        form_id: input.formId ?? null,
        index_id: input.indexId ?? null,
        external_id: input.externalId ?? input.indexId ?? null,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        op: input.op,
        operator: input.operator ?? null,
        ip: input.ip ?? null,
        duration_ms: input.durationMs,
        status: input.status,
        message: input.message ?? null,
        error: input.error ? input.error.slice(0, MAX_ERROR_LENGTH) : null,
        payload: (input.payload ?? null) as Record<string, unknown> | null,
      });
      if (error) {
        console.error('[sync-log] failed to insert:', error.message);
      }
    } catch (err) {
      console.error('[sync-log] unexpected error:', err);
    }
  });
}

/**
 * 推送接口入口日志：打印来源、op、formId、indexId 与 body 大小。
 */
export function logPushReceived(tag: string, info: Record<string, unknown>): void {
  console.log(`[${tag}] push received`, JSON.stringify(info));
}

/**
 * 推送接口出口日志：打印处理耗时与状态。
 */
export function logPushAck(tag: string, info: Record<string, unknown>, startedAt: number): void {
  console.log(`[${tag}] push ack in ${Date.now() - startedAt}ms`, JSON.stringify(info));
}
