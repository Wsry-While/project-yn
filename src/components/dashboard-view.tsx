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
  Inbox,
  CalendarClock,
  CalendarDays,
  CalendarRange,
} from 'lucide-react';
import { appStore } from '@/lib/web/app-store';
import { projectWebService, type DashboardStats } from '@/lib/web/project-web-service';
import { workbenchWebService, type MyWorkbench } from '@/lib/web/workbench-web-service';
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

const SOURCE_META: Record<
  string,
  { label: string; tone: string }
> = {
  trip: { label: '外出', tone: 'text-sky-500' },
  bidding: { label: '招投标', tone: 'text-violet-500' },
  demand: { label: '建设申请', tone: 'text-teal-500' },
  qiming: { label: '启明星', tone: 'text-amber-500' },
};

function WorkbenchBucket({
  label,
  icon: Icon,
  tone,
  items,
  cap = 6,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  items: MyWorkbench['items'][keyof MyWorkbench['items']];
  cap?: number;
}) {
  const shown = items.slice(0, cap);
  const remaining = items.length - shown.length;
  return (
    <div className="flex min-h-[200px] flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Icon className={cn('h-3.5 w-3.5', tone)} />
          {label}
        </div>
        <span className="font-mono text-xs tabular-nums text-foreground">{items.length}</span>
      </div>
      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground/60">
          —
        </div>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((it) => {
            const meta = SOURCE_META[it.source];
            return (
              <li key={`${it.source}-${it.id}`}>
                <Link
                  href={it.url}
                  className="group flex items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs hover:border-border hover:bg-muted/60"
                >
                  <span className={cn('mt-0.5 shrink-0 font-mono text-[10px] uppercase', meta.tone)}>
                    {meta.label}
                  </span>
                  <span className="flex-1 truncate text-foreground/90 group-hover:text-foreground">
                    {it.title.replace(/^[^·]+·\s*/, '')}
                  </span>
                  {it.date && (
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[10px] tabular-nums',
                        tone === 'text-red-500' ? 'text-red-500' : 'text-muted-foreground',
                      )}
                    >
                      {it.date.slice(5, 10)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
          {remaining > 0 && (
            <li className="px-2 pt-1 text-center text-[10px] text-muted-foreground">
              还有 {remaining} 条…
            </li>
          )}
        </ul>
      )}
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
  const [workbench, setWorkbench] = useState<MyWorkbench | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const jobs: Array<Promise<unknown>> = [workbenchWebService.mine().then((w) => {
      if (!cancelled) setWorkbench(w);
    })];
    if (project) {
      jobs.push(
        projectWebService.stats(project.id).then((s) => !cancelled && setStats(s)),
        projectWebService.activity(project.id, 20).then((a) => !cancelled && setActivity(a)),
      );
    }
    Promise.all(jobs)
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [project]);

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
              {project ? project.name : '仪表盘'}
            </h1>
            <Button asChild size="sm" variant="secondary">
              <Link href="/kanban">
                前往看板
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          {project?.description && (
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

        {/* 我的工作台：跨四大业务源的个人待办 */}
        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-brand" />
              <h2 className="text-sm font-semibold tracking-tight">
                我的工作台
                {workbench?.member && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    · {workbench.member.name}
                  </span>
                )}
              </h2>
            </div>
            <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
              <span>外出 {workbench?.bySource.trip ?? 0}</span>
              <span>招投标 {workbench?.bySource.bidding ?? 0}</span>
              <span>建设申请 {workbench?.bySource.demand ?? 0}</span>
              <span>启明星 {workbench?.bySource.qiming ?? 0}</span>
            </div>
          </div>

          {!workbench?.member ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              尚未在员工档案中匹配到你的账号
              {workbench?.selfUid ? (
                <>
                  （超星 UID：<span className="font-mono">{workbench.selfUid}</span>）
                </>
              ) : (
                '（未获取到超星 UID）'
              )}
              。等业务推送一条你参与的工单后即可自动关联；若你已有参与工单仍看不到，请联系管理员在「团队」里补全你的超星 UID。
            </div>
          ) : workbench.counts.total === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              目前没有未完成的工单 🎉
            </div>
          ) : (
            <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-4 md:divide-x md:divide-y-0">
              <WorkbenchBucket
                label="已逾期"
                icon={AlertTriangle}
                tone="text-red-500"
                items={workbench.items.overdue}
              />
              <WorkbenchBucket
                label="今日到期"
                icon={Clock}
                tone="text-amber-500"
                items={workbench.items.today}
              />
              <WorkbenchBucket
                label="7 天内"
                icon={CalendarRange}
                tone="text-brand"
                items={workbench.items.week}
              />
              <WorkbenchBucket
                label="以后"
                icon={CalendarDays}
                tone="text-muted-foreground"
                items={workbench.items.later}
                cap={5}
              />
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="待办"
            value={stats?.totals.todo ?? (project ? '—' : '—')}
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
            hint={stats ? `共 ${stats.total} 个任务` : undefined}
          />
        </div>

        {project && stats && (
          <div className="rounded-lg border border-border bg-card p-5">
            <ProgressBar ratio={stats.doneRatio} />
          </div>
        )}

        {project && (
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
                            {t.dueDate ? new Date(t.dueDate).toLocaleDateString('zh-CN') : '—'}
                          </span>
                        </li>
                      );
                    })}
                    {(stats?.overdue.length ?? 0) === 0 && (
                      <li className="text-xs text-muted-foreground">无逾期任务</li>
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
                            {t.dueDate ? new Date(t.dueDate).toLocaleDateString('zh-CN') : '—'}
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
        )}
      </div>
    </LlmLoadingMask>
  );
}
