'use client';
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 顶栏右侧附加内容（如编辑按钮组） */
  extra?: React.ReactNode;
  /** 底部固定操作栏 */
  footer?: React.ReactNode;
  width?: number;
  className?: string;
  children: React.ReactNode;
}

/**
 * 右侧滑出详情抽屉。
 * 与 EditDrawer 视觉对称，用于替代业务列表的详情 Modal：
 * - 不打断主列表上下文（保留滚动位置与筛选）
 * - 桌面端从右侧滑入，宽度默认 720px
 * - 移动端全宽
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  description,
  extra,
  footer,
  width = 720,
  className,
  children,
}: DetailDrawerProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div
        className={cn(
          'relative flex h-full flex-col bg-card shadow-dropdown animate-slide-in-right',
          className,
        )}
        style={{ width: 'min(100vw, var(--detail-w, 720px))' }}
      >
        <style>{`:root{--detail-w:${width}px}`}</style>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
            {description && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {extra}
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-card px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
