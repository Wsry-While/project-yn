'use client';
import { readStorage, writeStorage } from '@/lib/web/storage';
import type { ChatMessage } from '@/lib/domain/llm-types';

/**
 * 大模型会话上下文管理：
 * - 按场景分别保存对话历史（localStorage，持久化）
 * - 提供 append/reset 方法，保证 messages 数组只包含合法 role
 * - 每次发起请求前取 history，响应结束后追加 user+assistant 消息
 */

const HISTORY_LIMIT = 40;

type Scenario = 'general' | 'build-plan' | 'qiming-course';

const KEY_MAP: Record<Scenario, string> = {
  general: 'pc_llm_history_general',
  'build-plan': 'pc_llm_history_build_plan',
  'qiming-course': 'pc_llm_history_qiming',
};

export function loadHistory(scenario: Scenario): ChatMessage[] {
  return readStorage<ChatMessage[]>(KEY_MAP[scenario], []);
}

export function saveHistory(scenario: Scenario, messages: ChatMessage[]): void {
  writeStorage(KEY_MAP[scenario], messages.slice(-HISTORY_LIMIT));
}

export function appendUserMessage(scenario: Scenario, content: string): ChatMessage[] {
  const next = [...loadHistory(scenario), { role: 'user', content } satisfies ChatMessage];
  saveHistory(scenario, next);
  return next;
}

export function appendAssistantMessage(scenario: Scenario, content: string): ChatMessage[] {
  const next = [...loadHistory(scenario), { role: 'assistant', content } satisfies ChatMessage];
  saveHistory(scenario, next);
  return next;
}

export function resetHistory(scenario: Scenario): void {
  writeStorage(KEY_MAP[scenario], []);
}
