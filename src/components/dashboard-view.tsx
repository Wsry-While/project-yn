'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  ArrowRight,
  KanbanSquare,
  Inbox,
  LayoutDashboard,
  ListChecks,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { appStore } from '@/lib/web/app-store';
import {
  projectWebService,
  type DashboardStats,
  type TrendPoint,
  type TypeDistributionPoint,
} from '@/lib/web/project-web-service';
import { workbenchWebService, type MyWorkbench } from '@/lib/web/workbench-web-service';
import { Timeline, type TimelineItem } from '@/components/timeline';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/kpi-card';
import { Badge } from '@/components/ui/badge';
import type { ActivityLog, TaskStatus } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const STATUS_META: Record<
  TaskStatus,
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  todo: { label: '待办', icon: Circle, tone: 'text-muted-foreground' },
  in_progress: { label: '进行中', icon: Clock, tone: 'text-brand' },
  review: { label: '审阅中', icon: AlertTriangle, tone: 'text-status-warning' },
  done: { label: '已完成', icon: CheckCircle2, tone: 'text-status-success' },
};

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

const TASK_TYPE_LABEL: Record<string, string> = {
  requirement: '需求',
  development: '研发',
  design: '设计',
  testing: '测试',
  bug: '缺陷',
  document: '文档',
  delivery: '交付',
  other: '其他',
};

const SOURCE_LABEL: Record<string, string> = {
  trip: '外出',
  bidding: '招投标',
  demand: '建设申请',
  qiming: '启明星',
};

function ChartCard({
  title,
  subtitle,
  children,
  className,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-md border border-border bg-card', className)}>
      <div className="flex items-start justify-between border-b border-border px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ProgressBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">整体完成进度</span>
        <span className="font-mono font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
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
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [byType, setByType] = useState<TypeDistributionPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const jobs: Array<Promise<unknown>> = [
      workbenchWebService.mine().then((w) => {
        if (!cancelled) setWorkbench(w);
      }),
    ];
    if (project) {
      jobs.push(
        projectWebService.stats(project.id).then((s) => !cancelled && setStats(s)),
        projectWebService.activity(project.id, 20).then((a) => !cancelled && setActivity(a)),
        projectWebService.trend(project.id, 30).then((t) => !cancelled && setTrend(t)),
        projectWebService.byType(project.id).then((b) => !cancelled && setByType(b)),
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

  const chartData = useMemo(
    () =>
      trend.map((p) => ({
        date: p.date.slice(5),
        新建: p.created,
        完成: p.completed,
      })),
    [trend],
  );

  const pieData = useMemo(
    () =>
      byType.map((p) => ({
        name: TASK_TYPE_LABEL[p.type] ?? p.type,
        value: p.count,
      })),
    [byType],
  );

  const totalWorkbench = workbench?.counts.total ?? 0;
  const recentWorkbench = useMemo(() => {
    if (!workbench) return [];
    return [
      ...workbench.items.overdue,
      ...workbench.items.today,
      ...workbench.items.week,
      ...workbench.items.later,
    ].slice(0, 6);
  }, [workbench]);

  return (
    <LlmLoadingMask loading={loading} label="加载仪表数据…" className="min-h-[60vh]">
      <div className="mx-auto w-full max-w-[1400px] space-y-5 p-5 sm:p-6">
        {/* 页头 */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <LayoutDashboard className="h-3 w-3" />
              <span className="font-mono">dashboard</span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {project ? project.name : '项目驾驶舱'}
            </h1>
            {project?.description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{project.description}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                聚合团队任务、待办与近期动态，实时掌握项目健康度。
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href="/workbench">
                <Inbox className="h-3.5 w-3.5" />
                我的工作台
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/kanban">
                前往看板
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger"
          >
            加载失败：{error}
          </div>
        )}

        {/* 顶部 KPI */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="待办"
            value={stats?.totals.todo ?? '—'}
            icon={Circle}
            tone="neutral"
            hint={stats ? `共 ${stats.total} 个任务` : '加载中'}
          />
          <KpiCard
            label="进行中"
            value={stats?.totals.in_progress ?? '—'}
            icon={Clock}
            tone="brand"
          />
          <KpiCard
            label="审阅中"
            value={stats?.totals.review ?? '—'}
            icon={AlertTriangle}
            tone="warning"
          />
          <KpiCard
            label="已完成"
            value={stats?.totals.done ?? '—'}
            icon={CheckCircle2}
            tone="success"
            delta={
              stats && stats.total > 0 ? Math.round(stats.doneRatio * 100) : undefined
            }
            hint={stats ? `完成率` : undefined}
          />
        </div>

        {/* 进度条 */}
        {project && stats && (
          <div className="rounded-md border border-border bg-card px-5 py-4">
            <ProgressBar ratio={stats.doneRatio} />
          </div>
        )}

        {/* 我的工作台（精简版） */}
        <section className="rounded-md border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-brand" />
              <h2 className="text-sm font-semibold tracking-tight">我的待办</h2>
              {workbench?.member && (
                <span className="text-xs text-muted-foreground">· {workbench.member.name}</span>
              )}
              <Badge tone="brand" className="ml-1">
                {totalWorkbench}
              </Badge>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link href="/workbench">
                查看全部
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
          {!workbench?.member ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">
              尚未在员工档案中匹配到你的账号，待业务推送你参与的工单后即可自动关联。
            </div>
          ) : totalWorkbench === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <CheckCircle2 className="h-6 w-6 text-status-success" />
              <p className="text-sm text-foreground/80">目前没有未完成的工单</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentWorkbench.map((it) => {
                const isOverdue = workbench.items.overdue.some((x) => x.id === it.id);
                return (
                  <Link
                    key={`${it.source}-${it.id}`}
                    href={it.url}
                    className="flex items-center gap-3 px-5 py-2.5 text-xs transition-colors hover:bg-muted/50"
                  >
                    <Badge tone={isOverdue ? 'danger' : 'neutral'}>{SOURCE_LABEL[it.source] ?? it.source}</Badge>
                    <span className="min-w-0 flex-1 truncate text-foreground/85">{it.title}</span>
                    {it.school && (
                      <span className="hidden max-w-[200px] truncate text-muted-foreground md:inline">
                        {it.school}
                      </span>
                    )}
                    {it.date && (
                      <span
                        className={cn(
                          'shrink-0 font-mono tabular-nums',
                          isOverdue ? 'text-status-danger' : 'text-muted-foreground',
                        )}
                      >
                        {it.date.slice(5, 10)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* 图表区：只在选中项目时展示 */}
        {project && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard
              title="近 30 天任务趋势"
              subtitle="按任务创建 / 完成日期聚合"
              className="lg:col-span-2"
            >
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad-created" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="grad-done" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={{ stroke: 'var(--border)' }}
                      tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                      minTickGap={24}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                      width={36}
                    />
                    <Tooltip
                      cursor={{ stroke: 'var(--brand)', strokeWidth: 1, strokeDasharray: '4 4' }}
                      contentStyle={{
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        fontSize: 12,
                        fontFamily: 'var(--font-mono)',
                      }}
                      labelStyle={{ color: 'var(--muted-foreground)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="新建"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      fill="url(#grad-created)"
                    />
                    <Area
                      type="monotone"
                      dataKey="完成"
                      stroke="var(--chart-3)"
                      strokeWidth={2}
                      fill="url(#grad-done)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard title="任务类型分布" subtitle="按 task_type 聚合">
              <div className="h-[280px] w-full">
                {pieData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    暂无任务数据
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="45%"
                        innerRadius={48}
                        outerRadius={78}
                        paddingAngle={2}
                      >
                        {pieData.map((_, idx) => (
                          <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        iconType="circle"
                        wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </ChartCard>
          </div>
        )}

        {/* 到期任务 + 最近动态 */}
        {project && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-md border border-border bg-card lg:col-span-2">
              <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <KanbanSquare className="h-4 w-4 text-brand" />
                <h2 className="text-sm font-semibold">即将到期 / 已逾期</h2>
              </div>
              <div className="grid gap-0 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-status-danger">
                      已逾期
                    </span>
                    <Badge tone="danger">{stats?.overdue.length ?? 0}</Badge>
                  </div>
                  <ul className="space-y-1.5">
                    {(stats?.overdue ?? []).slice(0, 4).map((t) => {
                      const Meta = STATUS_META[t.status];
                      const Icon = Meta.icon;
                      return (
                        <li
                          key={t.id}
                          className="flex items-center gap-2 rounded-md border border-status-danger/20 bg-status-danger/5 px-2.5 py-1.5 text-xs"
                        >
                          <Icon className={cn('h-3.5 w-3.5 shrink-0', Meta.tone)} />
                          <span className="flex-1 truncate">{t.title}</span>
                          <span className="font-mono text-status-danger">
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
                <div className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-brand">
                      7 天内到期
                    </span>
                    <Badge tone="brand">{stats?.upcoming.length ?? 0}</Badge>
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

            <div className="rounded-md border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <ListChecks className="h-4 w-4 text-brand" />
                <h2 className="text-sm font-semibold">最近动态</h2>
              </div>
              <div className="p-4">
                <Timeline items={items} />
              </div>
            </div>
          </div>
        )}
      </div>
    </LlmLoadingMask>
  );
}
