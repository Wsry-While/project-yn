import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { fail, ok, withApi } from '@/lib/domain/http';
import { requireUser } from '@/lib/domain/api-utils';
import { buildMessages, LLM_CONFIG } from '@/lib/domain/llm-prompts';
import type { ChatRequest } from '@/lib/domain/llm-types';

/**
 * 【AI-Agent 挂载预留位】
 * POST /api/agent/qiming-course
 *
 * 生成启明星课程导入数据（JSON / CSV）。
 * 当前用 LLM 输出 JSON，后续可替换为 Coze Workflow：
 * - 若 ?format=csv，返回 text/csv 下载流；
 * - 默认返回 application/json。
 */
export async function POST(request: NextRequest) {
  return withApi(async () => {
    const auth = await requireUser(request);
    if ('status' in auth) return auth;
    const body = (await request.json().catch(() => ({}))) as {
      prompt?: unknown;
      context?: Record<string, string>;
      history?: ChatRequest['history'];
      format?: 'json' | 'csv';
    };
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return fail('invalid_param', 'prompt 不能为空', 400);
    }

    const messages = buildMessages({
      scenario: 'qiming-course',
      prompt: body.prompt,
      context: body.context,
      history: body.history,
    });
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const client = new LLMClient(new Config({ timeout: 60_000 }), customHeaders);

    let raw = '';
    try {
      for await (const part of client.stream(messages, {
        model: LLM_CONFIG.model,
        temperature: 0.3,
      })) {
        raw += part?.content?.toString?.() ?? '';
      }
    } catch (err) {
      console.error('[agent/qiming-course] error:', err);
      return fail('llm_error', err instanceof Error ? err.message : 'AI 调用失败', 502);
    }

    // 容错：模型可能用 ```json 包裹
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return fail('parse_error', 'AI 返回的 JSON 无法解析', 502, { raw: cleaned.slice(0, 500) });
    }

    if (body.format === 'csv') {
      const csv = toCsv(parsed);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="qiming-course.csv"',
        },
      });
    }

    return ok(parsed);
  });
}

interface QimingCourse {
  course?: {
    title?: string;
    subtitle?: string;
    description?: string;
    tags?: string[];
    chapters?: Array<{
      title?: string;
      order?: number;
      lessons?: Array<{ title?: string; order?: number; durationMinutes?: number; type?: string }>;
    }>;
  };
}

function toCsv(value: unknown): string {
  const data = (value as QimingCourse)?.course;
  if (!data) return '';
  const rows: string[][] = [
    ['course_title', 'chapter_title', 'chapter_order', 'lesson_title', 'lesson_order', 'duration_minutes', 'type'],
  ];
  for (const ch of data.chapters ?? []) {
    for (const ls of ch.lessons ?? []) {
      rows.push([
        data.title ?? '',
        ch.title ?? '',
        String(ch.order ?? ''),
        ls.title ?? '',
        String(ls.order ?? ''),
        String(ls.durationMinutes ?? ''),
        ls.type ?? '',
      ]);
    }
  }
  return rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
