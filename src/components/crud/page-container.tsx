'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * RuoYi 风格的页面容器：白色卡片、淡阴影、4px 圆角。
 * 顶部可选标题/副标题与右侧操作区。
 */
export function PageContainer({
  title,
  description,
  extra,
  children,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {(title || extra) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h1 className="text-[20px] font-semibold leading-7 text-foreground">{title}</h1>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {extra && <div className="flex flex-wrap items-center gap-2">{extra}</div>}
        </div>
      )}
      <div className="rounded-md border border-border bg-card shadow-card">{children}</div>
    </div>
  );
}

export function PageCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-md border border-border bg-card shadow-card', className)}>
      {children}
    </div>
  );
}
