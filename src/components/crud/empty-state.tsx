'use client';
import { Inbox } from 'lucide-react';

export function EmptyState({
  title = '暂无数据',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground/60">
        <Inbox className="h-7 w-7" />
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">{title}</div>
      {description && (
        <div className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
