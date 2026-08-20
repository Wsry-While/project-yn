'use client';
import { cn } from '@/lib/utils';

export type BadgeTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const TONE: Record<BadgeTone, string> = {
  brand: 'bg-brand/10 text-brand border-brand/20',
  success: 'bg-status-success/12 text-status-success border-status-success/25',
  warning: 'bg-status-warning/12 text-status-warning border-status-warning/25',
  danger: 'bg-status-danger/12 text-status-danger border-status-danger/25',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  neutral: 'bg-muted text-muted-foreground border-transparent',
};

interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', dot, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium leading-[18px]',
        TONE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * 根据业务状态文本推断 Badge tone，用于统一列表页状态列。
 */
export function toneFromStatus(status: string | null | undefined): BadgeTone {
  if (!status) return 'neutral';
  const s = status.trim();
  if (!s) return 'neutral';
  if (/已完成|已交付|已通过|已结项|已解决|closed|done/i.test(s)) return 'success';
  if (/已拒绝|失败|已逾期|驳回|invalid|已删除/i.test(s)) return 'danger';
  if (/待审批|待反馈|待交付|审阅中|进行中|处理中|pending|review/i.test(s)) return 'warning';
  if (/新建|待开始|todo/i.test(s)) return 'info';
  return 'neutral';
}
