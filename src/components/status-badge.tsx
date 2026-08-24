'use client';
import type { ComponentType, ReactNode } from 'react';
import type { BadgeTone } from '@/components/ui/badge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface StatusMeta {
  label: string;
  tone: BadgeTone;
  /** 可选 lucide 图标组件 */
  icon?: ComponentType<{ className?: string }>;
  /** 是否显示圆点（无 icon 时） */
  dot?: boolean;
}

export type StatusMap<V extends string | number> = Record<string, StatusMeta>;

/**
 * 统一状态标签：把业务状态值映射到颜色/文案/图标。
 * 未命中映射时回退为 neutral + 原始值。
 */
export function StatusBadge<V extends string | number>({
  value,
  map,
  fallback,
  className,
  children,
}: {
  value: V | null | undefined;
  map: StatusMap<V>;
  fallback?: Partial<StatusMeta>;
  className?: string;
  /** 额外内容（如逾期标记），追加在 label 后 */
  children?: ReactNode;
}) {
  const key = value == null ? '' : String(value);
  const meta: StatusMeta =
    (map[key] as StatusMeta | undefined) ?? {
      label: key || fallback?.label || '—',
      tone: fallback?.tone ?? 'neutral',
      icon: fallback?.icon,
      dot: fallback?.dot,
    };
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} dot={!Icon && meta.dot !== false ? !!meta.dot : false} className={cn('shrink-0', className)}>
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {meta.label}
      {children}
    </Badge>
  );
}
