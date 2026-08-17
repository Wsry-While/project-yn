'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Trash2, X, FileText, GraduationCap } from 'lucide-react';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Button } from '@/components/ui/button';
import { chatWithAssistant, generateBuildPlan, generateQimingCourse } from '@/lib/web/agent-bridge';
import { loadHistory, resetHistory } from '@/lib/web/session-context';
import { showToast } from '@/lib/web/toast-store';
import { cn } from '@/lib/utils';

type Tab = 'chat' | 'build-plan' | 'qiming';

interface UiMessage {
  role: 'user' | 'assistant';
  content: string;
}

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'chat', label: '项目助理', icon: Sparkles },
  { id: 'build-plan', label: '建设方案', icon: FileText },
  { id: 'qiming', label: '启明星', icon: GraduationCap },
];

/**
 * 右下角 AI 助手浮层：
 * - 局部 LlmLoadingMask，不阻塞页面
 * - 三个场景标签：通用对话 / 生成建设方案（流式 Markdown） / 启明星课程 JSON
 * - 对话历史通过 session-context 持久化
 */
export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const cancelRef = useRef<(() => void) | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const hist = loadHistory(tab === 'build-plan' ? 'build-plan' : tab === 'qiming' ? 'qiming-course' : 'general');
      setMessages(
        hist.map((m) =>
          m.role === 'user' || m.role === 'assistant'
            ? { role: m.role, content: m.content }
            : { role: 'assistant', content: m.content },
        ),
      );
      setResult('');
    }
  }, [open, tab]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, result]);

  function handleSend() {
    const prompt = input.trim();
    if (!prompt || loading) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: prompt }]);
    setLoading(true);
    setResult('');

    if (tab === 'qiming') {
      generateQimingCourse(prompt)
        .then((data) => {
          setResult(JSON.stringify(data, null, 2));
          setMessages((m) => [
            ...m,
            { role: 'assistant', content: '已生成课程 JSON，可复制导出。' },
          ]);
        })
        .catch((err: Error) => {
          showToast(err.message || '生成失败', { kind: 'error' });
        })
        .finally(() => setLoading(false));
      return;
    }

    let acc = '';
    cancelRef.current =
      tab === 'build-plan'
        ? generateBuildPlan(prompt, {}, {
            onDelta: (t) => {
              acc += t;
              setResult(acc);
            },
            onDone: () => {
              setMessages((m) => [...m, { role: 'assistant', content: acc || '（空）' }]);
              setResult('');
              setLoading(false);
            },
            onError: (err) => {
              showToast(err.message, { kind: 'error' });
              setLoading(false);
            },
          })
        : chatWithAssistant(prompt, {
            onDelta: (t) => {
              acc += t;
              setResult(acc);
            },
            onDone: () => {
              setMessages((m) => [...m, { role: 'assistant', content: acc || '（空）' }]);
              setResult('');
              setLoading(false);
            },
            onError: (err) => {
              showToast(err.message, { kind: 'error' });
              setLoading(false);
            },
          });
  }

  function handleReset() {
    const scenario = tab === 'build-plan' ? 'build-plan' : tab === 'qiming' ? 'qiming-course' : 'general';
    resetHistory(scenario);
    setMessages([]);
    setResult('');
    showToast('已清空当前会话', { kind: 'info' });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '收起 AI 助手' : '打开 AI 助手'}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-[80] inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_8px_24px_rgba(79,70,229,0.4)] transition hover:scale-105 hover:bg-brand/90 active:scale-95"
      >
        <Sparkles className="h-5 w-5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="AI 助手"
          className="fixed bottom-20 right-5 z-[80] flex h-[520px] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_24px_60px_rgba(0,0,0,0.28)] animate-fade-in-up"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition',
                      tab === t.id
                        ? 'bg-brand-muted text-brand'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleReset}
                aria-label="清空会话"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <LlmLoadingMask loading={loading} className="flex-1 overflow-hidden">
            <div
              ref={bodyRef}
              className="h-full space-y-3 overflow-y-auto px-3 py-3 text-sm"
            >
              {messages.length === 0 && !result && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <Sparkles className="h-6 w-6 text-brand" />
                  <p>
                    {tab === 'qiming'
                      ? '描述课程主题，我来生成启明星课程导入数据（JSON）。'
                      : tab === 'build-plan'
                        ? '描述项目背景，我来生成结构化建设方案。'
                        : '问我任何项目管理相关的问题，我会基于当前项目上下文回答。'}
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    'whitespace-pre-wrap rounded-md px-3 py-2 text-[13px] leading-relaxed',
                    m.role === 'user'
                      ? 'ml-8 bg-brand-muted text-foreground'
                      : 'mr-8 bg-muted text-foreground',
                  )}
                >
                  {m.content}
                </div>
              ))}
              {result && (
                <pre className="mr-8 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted px-3 py-2 font-mono text-[12px] leading-relaxed">
                  {result}
                </pre>
              )}
            </div>
          </LlmLoadingMask>

          <div className="border-t border-border p-2.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={2}
                placeholder={
                  tab === 'qiming'
                    ? '例：面向新员工的 Go 微服务入门课，共 8 课时……'
                    : tab === 'build-plan'
                      ? '例：我们要做一个内部审批中心，3 个月内上线……'
                      : '说点什么……（Enter 发送，Shift+Enter 换行）'
                }
                className="max-h-28 min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-2 text-[13px] outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <Button type="submit" size="icon" disabled={loading || !input.trim()} aria-label="发送">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
