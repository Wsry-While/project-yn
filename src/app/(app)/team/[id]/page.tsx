'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Award,
  Briefcase,
  Building2,
  CalendarClock,
  Mail,
  TrendingDown,
  UserCircle2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { apiFetch } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import type { Person360View } from '@/lib/domain/person-360-service';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { Badge } from '@/components/ui/badge';
import {
  CHART_COLORS,
  ChartTooltipContent,
} from '@/components/chart-theme';

const SOURCE_LABEL: Record<string, string> = {
  bidding: '招投标',
  demand: '建设申请',
  qiming: '启明星',
  trip: '项目外出',
};

export default function Person360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [view, setView] = useState<Person360View | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Person360View>(`/api/team/${id}/360`);
      setView(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载客户经理 360 失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    if (!view) return null;
    const { kpi, bySource } = view;
    const totalBusiness = bySource.bidding + bySource.demand + bySource.qiming + bySource.trip;
    return {
      totalBusiness,
      avgScoreLabel: kpi.avgScore == null ? '—' : kpi.avgScore.toFixed(2),
      overduePct: `${Math.round(kpi.overdueRate * 100)}%`,
    };
  }, [view]);

  if (loading || !view) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-md bg-muted/40" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-md bg-muted/40" />
      </div>
    );
  }

  if (!view.person) {
    return <div className="py-20 text-center text-sm text-muted-foreground">未找到该成员</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Link href="/team" className="hover:text-brand">
          团队
        </Link>
        <span>/</span>
        <span className="text-foreground/80">{view.person.name} 360 视图</span>
      </div>
      <PageHeader
        icon={<UserCircle2 className="h-4 w-4" />}
        title={view.person.name}
        subtitle={[view.person.title, view.person.department, view.person.isLeader ? '负责人' : null]
          .filter(Boolean)
          .join(' · ')}
        breadcrumb={[{ label: '团队', href: '/team' }, { label: view.person.name }]}
        actions={
          <Link
            href="/team"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted/40"
          >
            <ArrowLeft className="h-3 w-3" />
            返回团队
          </Link>
        }
      >
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          {view.person.email && (
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {view.person.email}
            </span>
          )}
          {view.person.isLeader && (
            <Badge tone="brand" dot>
              团队负责人
            </Badge>
          )}
          {!view.person.isEnabled && <Badge tone="danger">已停用</Badge>}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="在办工单"
          value={view.kpi.inProgress}
          icon={<Briefcase className="h-4 w-4" />}
          tone="brand"
          hint="跨四源在办数"
        />
        <KpiCard
          label="本月外出"
          value={view.kpi.tripsThisMonth}
          icon={<CalendarClock className="h-4 w-4" />}
          tone="info"
        />
        <KpiCard
          label="客户均分"
          value={stats!.avgScoreLabel}
          icon={<Award className="h-4 w-4" />}
          tone="success"
          hint="近半年外出评分"
        />
        <KpiCard
          label="逾期率"
          value={stats!.overduePct}
          icon={<TrendingDown className="h-4 w-4" />}
          tone={view.kpi.overdueRate > 0.2 ? 'danger' : view.kpi.overdueRate > 0 ? 'warning' : 'success'}
          hint="在办工单中已逾期占比"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-md border border-border bg-card lg:col-span-2">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span className="h-2 w-2 rounded-full bg-brand" />
              近 6 个月业务量
            </h2>
            <span className="text-[11px] text-muted-foreground">按创建 / 外出日期统计</span>
          </header>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.monthlyBusiness} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltipContent />} cursor={{ fill: 'var(--muted)', opacity: 0.25 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <Bar dataKey="bidding" name="招投标" stackId="a" fill={CHART_COLORS[0]} radius={[0, 0, 0, 0]} />
                <Bar dataKey="demand" name="建设申请" stackId="a" fill={CHART_COLORS[1]} />
                <Bar dataKey="qiming" name="启明星" stackId="a" fill={CHART_COLORS[2]} />
                <Bar dataKey="trip" name="项目外出" stackId="a" fill={CHART_COLORS[3]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              评分趋势
            </h2>
            <span className="text-[11px] text-muted-foreground">月度均分</span>
          </header>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={view.scoreTrend} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 5]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="avgScore"
                  name="均分"
                  stroke={CHART_COLORS[2]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CHART_COLORS[2] }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-md border border-border bg-card lg:col-span-2">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4 text-brand" />
              负责学校 Top 8
            </h2>
            <span className="text-[11px] text-muted-foreground">按累计业务量排序</span>
          </header>
          {view.topSchools.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-muted-foreground">暂无关联学校记录</div>
          ) : (
            <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
              {view.topSchools.map((s) => {
                const total = s.bidding + s.demand + s.qiming + s.trip;
                return (
                  <Link
                    key={s.schoolId}
                    href={`/schools/${s.schoolId}`}
                    className="group flex items-center justify-between gap-3 bg-card px-4 py-3 transition hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-foreground group-hover:text-brand">
                        {s.schoolName}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span>招投标 {s.bidding}</span>
                        <span className="text-border">·</span>
                        <span>建设 {s.demand}</span>
                        <span className="text-border">·</span>
                        <span>启明星 {s.qiming}</span>
                        <span className="text-border">·</span>
                        <span>外出 {s.trip}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-base font-semibold text-brand">{total}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {s.lastVisit ? `最近 ${s.lastVisit}` : '无外出'}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-md border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              最近动态
            </h2>
            <span className="text-[11px] text-muted-foreground">{view.recentItems.length} 条</span>
          </header>
          <ol className="max-h-[420px] divide-y divide-border overflow-auto">
            {view.recentItems.map((it) => (
              <li key={`${it.source}-${it.id}`}>
                <Link href={it.url} className="flex flex-col gap-0.5 px-4 py-2.5 text-xs transition hover:bg-muted/40">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="neutral" className="font-mono uppercase tracking-wider">
                      {SOURCE_LABEL[it.source]}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">{it.date}</span>
                  </div>
                  <div className="line-clamp-1 text-[12.5px] font-medium text-foreground">{it.title}</div>
                  {it.status && <div className="truncate text-[10.5px] text-muted-foreground">{it.status}</div>}
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
