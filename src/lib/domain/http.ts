import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/domain/types';

/**
 * 统一 JSON 返回。
 * 业务成功：`return ok(data)`
 * 业务失败：`return fail(code, message, status, details)`
 *
 * 任何抛出的异常都应在 Route Handler 顶层被 `withApi` 捕获。
 */
export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiResponse<T>> {
  return NextResponse.json<ApiResponse<T>>({ success: true, data }, init);
}

export function fail(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
): NextResponse<ApiResponse<never>> {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: { code, message, details } },
    { status },
  );
}

/**
 * 包装 API 逻辑，把未捕获异常统一转为 500，避免向客户端泄露堆栈。
 */
type AnyHandler<T extends Response> = (...args: never[]) => Promise<T>;

export async function withApi<T extends Response>(
  fn: AnyHandler<T>,
): Promise<T | NextResponse<ApiResponse<never>>> {
  try {
    return await fn();
  } catch (err) {
    console.error('[api] unhandled error:', err);
    const message = err instanceof Error ? err.message : 'internal error';
    return fail('internal_error', message, 500);
  }
}

export function readJson<T = unknown>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}
