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
  hint,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3 transition-colors hover:border-border/80">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
      </div>
      <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

const SOURCE_META: Record<
  string,
  { label: string }
> = {
  trip: { label: '外出' },
  bidding: { label: '招投标' },
  demand: { label: '建设申请' },
  qiming: { label: '启明星' },
};

const BUCKET_META: Record<
  keyof MyWorkbench['items'],
  { label: string; tone: string; dot: string }
> = {
  overdue: {
    label: '已逾期',
    tone: 'text-red-500',
    dot: 'bg-red-500',
  },
  today: {
    label: '今日到期',
    tone: 'text-amber-600 dark:text-amber-500',
    dot: 'bg-amber-500',
  },
  week: {
    label: '7 天内',
    tone: 'text-brand',
    dot: 'bg-brand',
  },
  later: {
    label: '以后',
    tone: 'text-muted-foreground',
    dot: 'bg-muted-foreground/40',
  },
};

function WorkbenchBucket({
  bucket,
  items,
  cap = 6,
}: {
  bucket: keyof MyWorkbench['items'];
  items: MyWorkbench['items'][keyof MyWorkbench['items']];
  cap?: number;
}) {
  const meta = BUCKET_META[bucket];
  const shown = items.slice(0, cap);
  const remaining = items.length - shown.length;
  return (
    <div className="flex min-w-0 flex-col border-border p-3 [&:not(:last-child)]:border-b md:[&:not(:last-child)]:border-b-0 md:[&:not(:last-child)]:border-r">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden />
          {meta.label}
        </div>
        <span className="font-mono text-[11px] tabular-nums text-foreground/70">{items.length}</span>
      </div>
      {shown.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-muted-foreground/50">—</div>
      ) : (
        <ul className="space-y-px">
          {shown.map((it) => {
            const source = SOURCE_META[it.source];
            return (
              <li key={`${it.source}-${it.id}`}>
                <Link
                  href={it.url}
                  className="group flex items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-muted/60"
                >
                  <span className="shrink-0 rounded bg-muted px-1 py-px font-mono text-[10px] uppercase tracking-wide text-muted-foreground group-hover:text-foreground/80">
                    {source.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground/85 group-hover:text-foreground">
                    {it.title}
                  </span>
                  {it.date && (
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[10px] tabular-nums',
                        bucket === 'overdue' ? 'text-red-500' : 'text-muted-foreground/70',
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
            <li className="px-1.5 pt-1 text-center text-[10px] text-muted-foreground/70">
              还有 {remaining} 条
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
          className="animate-progress h-full rounded-full bg-brand"
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
            <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
              <span>外出 <span className="text-foreground/70">{workbench?.bySource.trip ?? 0}</span></span>
              <span className="text-border">·</span>
              <span>招投标 <span className="text-foreground/70">{workbench?.bySource.bidding ?? 0}</span></span>
              <span className="text-border">·</span>
              <span>建设 <span className="text-foreground/70">{workbench?.bySource.demand ?? 0}</span></span>
              <span className="text-border">·</span>
              <span>启明星 <span className="text-foreground/70">{workbench?.bySource.qiming ?? 0}</span></span>
            </div>
          </div>

          {!workbench?.member ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                <Inbox className="h-4 w-4" />
              </div>
              <p className="text-sm text-foreground/80">尚未在员工档案中匹配到你的账号</p>
              <p className="max-w-md text-xs text-muted-foreground">
                {workbench?.selfUid ? (
                  <>当前超星 UID：<span className="font-mono">{workbench.selfUid}</span>。</>
                ) : (
                  '未获取到超星 UID。'
                )}
                {' '}等业务推送一条你参与的工单后即可自动关联；若你已有参与工单仍看不到，请联系管理员在「团队」里补全该 UID。
              </p>
            </div>
          ) : workbench.counts.total === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <p className="text-sm text-foreground/80">目前没有未完成的工单</p>
              <p className="text-xs text-muted-foreground">所有分配给你的事项都已关闭。</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-4 md:divide-x md:divide-y-0">
              <WorkbenchBucket bucket="overdue" items={workbench.items.overdue} />
              <WorkbenchBucket bucket="today" items={workbench.items.today} />
              <WorkbenchBucket bucket="week" items={workbench.items.week} />
              <WorkbenchBucket bucket="later" items={workbench.items.later} cap={5} />
            </div>
          )}
        </section>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="待办"
            value={stats?.totals.todo ?? '—'}
            icon={Circle}
          />
          <StatCard
            label="进行中"
            value={stats?.totals.in_progress ?? '—'}
            icon={Clock}
          />
          <StatCard
            label="审阅中"
            value={stats?.totals.review ?? '—'}
            icon={AlertTriangle}
          />
          <StatCard
            label="已完成"
            value={stats?.totals.done ?? '—'}
            icon={CheckCircle2}
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
