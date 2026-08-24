'use client';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 业务列表页外壳：铺满主内容区、统一卡片边框与三段式（工具栏 / 列表体 / 分页）。
 * 配合 ListToolbar 使用。
 */
export function ListContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('w-full p-4 sm:p-6 lg:px-8', className)}>
      <div className="overflow-hidden rounded-md border border-border bg-card">{children}</div>
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
