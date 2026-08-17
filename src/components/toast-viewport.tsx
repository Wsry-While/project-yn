'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { toastStore, dismissToast, type ToastItem } from '@/lib/web/toast-store';
import { cn } from '@/lib/utils';

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

const TONE: Record<ToastItem['kind'], string> = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  info: 'text-brand',
};

/**
 * 全局消息提示。挂在 AppShell 根节点，右下角堆叠。
 */
export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => toastStore.subscribe((s) => setItems([...s.toasts])), []);

  return (
    <div
      role="region"
      aria-label="通知"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {items.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            role="status"
            className="animate-slide-in-right pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-popover p-3 shadow-[0_12px_32px_rgba(0,0,0,0.16)]"
          >
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE[t.kind])} aria-hidden />
            <p className="flex-1 text-sm leading-relaxed text-popover-foreground">{t.message}</p>
            <button
              type="button"
              aria-label="关闭通知"
              onClick={() => dismissToast(t.id)}
              className="text-muted-foreground transition hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
