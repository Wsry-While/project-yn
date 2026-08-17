'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  ArrowRight,
  KanbanSquare,
} from 'lucide-react';
import { appStore } from '@/lib/web/app-store';
import { projectWebService, type DashboardStats } from '@/lib/web/project-web-service';
import { Timeline, type TimelineItem } from '@/components/timeline';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Button } from '@/components/ui/button';
import type { ActivityLog, TaskStatus } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const STATUS_META: Record<
  TaskStatus,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  todo: { label: '待办', icon: Circle, tone: 'text-zinc-500' },
  in_progress: { label: '进行中', icon: Clock, tone: 'text-brand' },
  review: { label: '审阅中', icon: AlertTriangle, tone: 'text-amber-500' },
  done: { label: '已完成', icon: CheckCircle2, tone: 'text-emerald-500' },
};

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  hint?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-foreground">
            {value}
          </div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md bg-muted',
            tone,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">整体完成进度</span>
        <span className="font-mono tabular-nums text-foreground">{pct}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="animate-progress h-full rounded-full bg-gradient-to-r from-brand to-brand/70"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function DashboardView() {
  const project = appStore.use((s) => s.currentProject);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      projectWebService.stats(project.id),
      projectWebService.activity(project.id, 20),
    ])
      .then(([s, a]) => {
        if (cancelled) return;
        setStats(s);
        setActivity(a);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [project]);

  if (!project) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        尚未选择项目，请联系管理员创建项目后刷新。
      </div>
    );
  }

  const items: TimelineItem[] = activity.map((a) => ({
    id: a.id,
    actor: a.actorName,
    action: a.action,
    target: a.entityTitle ?? undefined,
    time: a.createdAt,
    tone:
      a.action.endsWith('.done') || a.action.endsWith('.create')
        ? 'success'
        : a.action.includes('delete')
          ? 'danger'
          : 'default',
  }));

  return (
    <LlmLoadingMask loading={loading} label="加载仪表数据…" className="min-h-[60vh]">
      <div className="mx-auto w-full max-w-6xl space-y-6 p-5 sm:p-8">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono uppercase tracking-wider">dashboard</span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <Button asChild size="sm" variant="secondary">
              <Link href="/kanban">
                前往看板
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          {project.description && (
            <p className="max-w-2xl text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500"
          >
            加载失败：{error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="待办"
            value={stats?.totals.todo ?? '—'}
            icon={Circle}
            tone="text-zinc-500"
          />
          <StatCard
            label="进行中"
            value={stats?.totals.in_progress ?? '—'}
            icon={Clock}
            tone="text-brand"
          />
          <StatCard
            label="审阅中"
            value={stats?.totals.review ?? '—'}
            icon={AlertTriangle}
            tone="text-amber-500"
          />
          <StatCard
            label="已完成"
            value={stats?.totals.done ?? '—'}
            icon={CheckCircle2}
            tone="text-emerald-500"
            hint={`共 ${stats?.total ?? 0} 个任务`}
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <ProgressBar ratio={stats?.doneRatio ?? 0} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <KanbanSquare className="h-4 w-4 text-brand" />
              即将到期 / 已逾期
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-amber-500">
                  已逾期
                </div>
                <ul className="space-y-1.5">
                  {(stats?.overdue ?? []).slice(0, 4).map((t) => {
                    const Meta = STATUS_META[t.status];
                    const Icon = Meta.icon;
                    return (
                      <li
                        key={t.id}
                        className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-xs"
                      >
                        <Icon className={cn('h-3.5 w-3.5 shrink-0', Meta.tone)} />
                        <span className="flex-1 truncate">{t.title}</span>
                        <span className="font-mono text-red-500">
                          {new Date(t.dueDate!).toLocaleDateString('zh-CN')}
                        </span>
                      </li>
                    );
                  })}
                  {(stats?.overdue.length ?? 0) === 0 && (
                    <li className="text-xs text-muted-foreground">无逾期任务 🎉</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-brand">
                  7 天内到期
                </div>
                <ul className="space-y-1.5">
                  {(stats?.upcoming ?? []).slice(0, 4).map((t) => {
                    const Meta = STATUS_META[t.status];
                    const Icon = Meta.icon;
                    return (
                      <li
                        key={t.id}
                        className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                      >
                        <Icon className={cn('h-3.5 w-3.5 shrink-0', Meta.tone)} />
                        <span className="flex-1 truncate">{t.title}</span>
                        <span className="font-mono text-muted-foreground">
                          {new Date(t.dueDate!).toLocaleDateString('zh-CN')}
                        </span>
                      </li>
                    );
                  })}
                  {(stats?.upcoming.length ?? 0) === 0 && (
                    <li className="text-xs text-muted-foreground">暂无即将到期任务</li>
                  )}
                </ul>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">最近动态</h2>
            <Timeline items={items} />
          </div>
        </div>
      </div>
    </LlmLoadingMask>
  );
}
