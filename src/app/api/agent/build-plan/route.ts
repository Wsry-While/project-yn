import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fail, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { buildMessages, getModelForScenario } from '@/lib/domain/llm-prompts';
import type { ChatRequest } from '@/lib/domain/llm-types';

/**
 * 【AI-Agent 挂载预留位】
 * POST /api/agent/build-plan — 生成项目建设方案（流式）
 *
 * 后续可把内部实现替换为 Coze Workflow / Bot 调用；
 * 当前先复用统一 LLM 网关，保证前后端接口稳定。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const body = (await request.json().catch(() => ({}))) as {
      prompt?: unknown;
      context?: Record<string, string>;
      history?: ChatRequest['history'];
    };
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return fail('invalid_param', 'prompt 不能为空', 400);
    }

    const messages = buildMessages({
      scenario: 'build-plan',
      prompt: body.prompt,
      context: body.context,
      history: body.history,
    });
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new LLMClient(new Config({ timeout: 90_000 }), customHeaders);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const part of client.stream(messages, {
            model: getModelForScenario('build-plan'),
            temperature: 0.5,
          })) {
            const text = part?.content?.toString?.() ?? '';
            if (text) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'delta', content: text })}\n\n`),
              );
            }
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        } catch (err) {
          console.error('[agent/build-plan] error:', err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : '生成失败' })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  });
}
