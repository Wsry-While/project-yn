'use client';
import { apiFetchSSE } from '@/lib/web/api-client';
import { appendAssistantMessage, appendUserMessage, loadHistory } from '@/lib/web/session-context';
import type { ChatMessage } from '@/lib/domain/llm-types';

/**
 * 【AI-Agent 挂载预留位】
 *
 * 前端通过 agentBridge 调用两个 AI 能力：
 *   1. generateBuildPlan：生成项目建设方案（流式 Markdown）
 *   2. generateQimingCourse：生成启明星课程结构化导入数据（JSON / CSV）
 *
 * 当前底层走 /api/agent/*；后续切换到 Coze Bot/Workflow 时只改这里的实现，
 * 对上层组件无感知。
 */

export interface AgentCallbacks {
  onDelta?: (text: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (err: Error) => void;
}

export function generateBuildPlan(
  prompt: string,
  context: Record<string, string> = {},
  callbacks: AgentCallbacks = {},
): () => void {
  const scenario = 'build-plan';
  appendUserMessage(scenario, prompt);
  const history: ChatMessage[] = loadHistory(scenario);
  let full = '';

  return apiFetchSSE(
    '/api/agent/build-plan',
    { prompt, context, history: history.slice(0, -1) },
    {
      onDelta: (text) => {
        full += text;
        callbacks.onDelta?.(text);
      },
      onDone: () => {
        if (full.trim()) appendAssistantMessage(scenario, full);
        callbacks.onDone?.(full);
      },
      onError: (err) => callbacks.onError?.(err),
    },
  );
}

export interface QimingCourseResult {
  course?: {
    title?: string;
    subtitle?: string;
    description?: string;
    chapters?: Array<{
      title?: string;
      order?: number;
      lessons?: Array<{ title?: string; order?: number; durationMinutes?: number; type?: string }>;
    }>;
  };
}

export async function generateQimingCourse(
  prompt: string,
  context: Record<string, string> = {},
): Promise<QimingCourseResult> {
  const scenario = 'qiming-course';
  appendUserMessage(scenario, prompt);
  const history = loadHistory(scenario);
  const result = await fetch('/api/agent/qiming-course', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, context, history: history.slice(0, -1), format: 'json' }),
  }).then(async (res) => {
    const j = (await res.json()) as
      | { success: true; data: QimingCourseResult }
      | { success: false; error: { message: string } };
    if (!res.ok || !j.success) throw new Error(j.success ? '请求失败' : j.error.message);
    return j.data;
  });
  appendAssistantMessage(scenario, JSON.stringify(result));
  return result;
}

/** 通用 LLM 对话（流式），用于侧边栏 AI 助手等。 */
export function chatWithAssistant(
  prompt: string,
  callbacks: AgentCallbacks = {},
): () => void {
  const scenario = 'general';
  appendUserMessage(scenario, prompt);
  const history = loadHistory(scenario);
  let full = '';
  return apiFetchSSE(
    '/api/llm/chat',
    { scenario, prompt, history: history.slice(0, -1) },
    {
      onDelta: (text) => {
        full += text;
        callbacks.onDelta?.(text);
      },
      onDone: () => {
        if (full.trim()) appendAssistantMessage(scenario, full);
        callbacks.onDone?.(full);
      },
      onError: (err) => callbacks.onError?.(err),
    },
  );
}
