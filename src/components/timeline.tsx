'use client';
import { cn } from '@/lib/utils';

export interface TimelineItem {
  id: string | number;
  actor?: string | null;
  action: string;
  target?: string | null;
  time: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

const DOT: Record<NonNullable<TimelineItem['tone']>, string> = {
  default: 'bg-zinc-400 dark:bg-zinc-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
};

const ACTION_LABEL: Record<string, string> = {
  'task.create': '创建了任务',
  'task.update': '更新了任务',
  'task.move.todo': '把任务移到「待办」',
  'task.move.in_progress': '开始处理任务',
  'task.move.review': '提交审阅',
  'task.move.done': '完成了任务',
  'task.external_push': '通过外部系统推送了任务',
  'project.create': '创建了项目',
  'project.update': '更新了项目设置',
  'member.invite': '邀请了成员',
};

function humanize(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
    return d.toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        暂无动态
      </div>
    );
  }
  return (
    <ol className={cn('relative space-y-4 pl-5', className)}>
      <span
        aria-hidden
        className="absolute left-[5px] top-1 bottom-1 w-px bg-border"
      />
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            aria-hidden
            className={cn(
              'absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background',
              DOT[item.tone ?? 'default'],
            )}
          />
          <div className="text-sm text-foreground">
            <span className="font-medium">{item.actor ?? '系统'}</span>
            <span className="mx-1.5 text-muted-foreground">{humanize(item.action)}</span>
            {item.target && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
                {item.target}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{formatTime(item.time)}</div>
        </li>
      ))}
    </ol>
  );
}
