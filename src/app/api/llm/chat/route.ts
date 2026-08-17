import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fail, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { buildMessages, LLM_CONFIG } from '@/lib/domain/llm-prompts';
import type { ChatRequest, ChatStreamChunk } from '@/lib/domain/llm-types';

/**
 * POST /api/llm/chat
 *
 * 流式返回 AI 响应：Content-Type: text/event-stream
 * 事件格式：
 *   data: {"type":"delta","content":"..."}
 *   data: {"type":"done"}
 *   data: {"type":"error","message":"..."}
 *
 * 客户端必须用 fetch + ReadableStream 增量读取，不能用 await res.json()。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;

    const body = (await request.json().catch(() => null)) as ChatRequest | null;
    if (!body || typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return fail('invalid_param', 'prompt 不能为空', 400);
    }
    const scenario = body.scenario ?? 'general';
    if (!['general', 'build-plan', 'qiming-course'].includes(scenario)) {
      return fail('invalid_param', 'scenario 非法', 400);
    }

    const messages = buildMessages(body);
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new LLMClient(new Config({ timeout: 60_000 }), customHeaders);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (chunk: ChatStreamChunk) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        };
        try {
          const gen = client.stream(messages, {
            model: LLM_CONFIG.model,
            temperature: LLM_CONFIG.temperature,
          });
          for await (const part of gen) {
            const text = part?.content?.toString?.() ?? '';
            if (text) send({ type: 'delta', content: text });
          }
          send({ type: 'done' });
        } catch (err) {
          console.error('[llm/chat] stream error:', err);
          send({
            type: 'error',
            message: err instanceof Error ? err.message : 'AI 调用失败',
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });
}
