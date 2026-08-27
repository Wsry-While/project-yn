/**
 * 前端统一请求封装。
 *
 * - 所有后端 REST 接口通过 `apiFetch` 调用；
 * - 自动解包 ApiResponse<T>，失败时抛出 ApiError；
 * - SSE 流式接口使用 `apiFetchSSE`，返回一个可迭代的异步生成器。
 *
 * 注意：本模块不包含全局 Loading。Loading 由具体调用方通过 LlmLoadingMask
 * 或页面状态管理，保证"加载过程页面可正常阅读交互"。
 */
import type { ApiResponse } from '@/lib/domain/types';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  input: string,
  init?: RequestInit & { query?: Record<string, string | number | undefined | null> },
): Promise<T> {
  const url = new URL(input, window.location.origin);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'same-origin',
  });
  let body: ApiResponse<T> | null = null;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('invalid_json', `响应不是合法 JSON（HTTP ${res.status}）`, res.status);
  }
  if (!res.ok || !body || body.success === false) {
    const message =
      (body && body.success === false && body.error.message) ||
      `请求失败（HTTP ${res.status}）`;
    const code = body && body.success === false ? body.error.code : 'http_error';
    const details = body && body.success === false ? body.error.details : undefined;
    throw new ApiError(code, message, res.status, details);
  }
  return body.data;
}

/**
 * 调用 SSE 接口并按事件块回调。
 * 返回一个 abort 函数，用于取消请求。
 */
export function apiFetchSSE(
  input: string,
  body: unknown,
  handlers: {
    onDelta: (text: string) => void;
    onDone: (evt?: unknown) => void;
    onError: (err: Error) => void;
    onMeta?: (meta: unknown) => void;
    onStep?: (step: { phase?: string; message?: string; [k: string]: unknown }) => void;
  },
): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(input, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new ApiError('http_error', `流式请求失败 (HTTP ${res.status})`, res.status);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload) as {
              type: 'delta' | 'done' | 'error' | 'meta' | 'step';
              content?: string;
              message?: string;
              phase?: string;
              [k: string]: unknown;
            };
            if (evt.type === 'delta' && evt.content) handlers.onDelta(evt.content);
            else if (evt.type === 'done') {
              handlers.onDone(evt);
              return;
            } else if (evt.type === 'meta') handlers.onMeta?.(evt);
            else if (evt.type === 'step') handlers.onStep?.(evt);
            else if (evt.type === 'error') throw new Error(evt.message ?? '流式响应错误');
          } catch (err) {
            handlers.onError(err instanceof Error ? err : new Error(String(err)));
            return;
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return () => controller.abort();
}
