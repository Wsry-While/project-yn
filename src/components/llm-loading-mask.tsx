'use client';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LlmLoadingMaskProps {
  loading: boolean;
  label?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * 【局部加载缓冲组件】
 *
 * 设计原则：
 * - 只覆盖父容器，绝不全屏遮罩
 * - 加载时容器仍可阅读和滚动，仅阻止内部交互（pointer-events-none）
 * - 右上角放一个小 Logo 旋转 + 扫描线，提示"AI 正在生成"
 */
export function LlmLoadingMask({
  loading,
  label = 'AI 正在生成…',
  className,
  children,
}: LlmLoadingMaskProps) {
  return (
    <div className={cn('relative', className)}>
      {children}
      {loading && (
        <div
          aria-live="polite"
          aria-busy="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] bg-background/60 backdrop-blur-[1px]"
        >
          <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
            <div className="animate-scanline h-px w-1/2 bg-gradient-to-r from-transparent via-brand to-transparent" />
          </div>
          <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-popover/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
            <Loader2 className="h-3 w-3 animate-spin-slow text-brand" aria-hidden />
            {label}
          </div>
        </div>
      )}
    </div>
  );
}
