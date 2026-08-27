/**
 * 大模型会话相关类型定义。
 *
 * 所有消息均在前端和后端之间以纯 JSON 传递；后端把消息转成
 * coze-coding-dev-sdk 需要的格式，再流式回传。
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  /** 业务场景：通用对话 / 生成建设方案 / 启明星课程数据 / 招投标评分项 / 截图建议 / 截图视觉理解 */
  scenario:
    | 'general'
    | 'build-plan'
    | 'qiming-course'
    | 'bidding-score'
    | 'bidding-advice'
    | 'bidding-vision'
    | 'bidding-vision-param';
  /** 用户这一轮的输入 */
  prompt: string;
  /** 历史消息（不含本轮用户输入；后端会自动追加） */
  history?: ChatMessage[];
  /** 可选：场景上下文（如项目名称、目标等），会注入到系统提示词末尾 */
  context?: Record<string, string>;
}

export interface ChatStreamChunk {
  type: 'delta' | 'done' | 'error';
  content?: string;
  message?: string;
}
