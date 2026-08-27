'use client';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 业务列表页外壳：由 AppShell 主区提供 p-4，本组件只负责白底卡片 + 圆角边框 + 淡阴影。
 * 配合 ListToolbar 使用。
 */
export function ListContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-md border border-border bg-card shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ListBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('divide-y divide-border', className)}>{children}</div>;
}

export function ListEmpty({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('p-10 text-center text-sm text-muted-foreground', className)}>{children}</div>
  );
}
