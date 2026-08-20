'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  BarChart3,
  HeartPulse,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  CHART_COLORS,
  ChartTooltipContent,
} from '@/components/chart-theme';
import type {
  AnalyticsDimension,
  AnalyticsMetric,
  AnalyticsResult,
} from '@/lib/domain/analytics-service';
import type { SchoolHealth } from '@/lib/domain/analytics-service';

interface NLRow {
  id: string;
  title: string;
  school: string | null;
  owner: string | null;
  date: string | null;
  status: string | null;
  url: string;
}

const DIMENSION_LABEL: Record<AnalyticsDimension, string> = {
  school: '学校',
  industry: '行业',
  sales: '销售/经理',
  product: '产品类型',
  year: '年度',
};
const METRIC_LABEL: Record<AnalyticsMetric, string> = {
  volume: '业务量',
  ontime: '完成率',
  score: '客户评分',
  trips: '外出次数',
};

function scoreTone(score: number): 'success' | 'warning' | 'danger' | 'info' {
  if (score >= 75) return 'success';
  if (score >= 50) return 'warning';
  if (score > 0) return 'danger';
  return 'info';
}

function HealthRadar({ h }: { h: SchoolHealth }) {
  const data = [
    { dim: '活跃度', value: h.dimensions.activity },
    { dim: '满意度', value: h.dimensions.satisfaction },
    { dim: '转化', value: h.dimensions.conversion },
    { dim: '准时率', value: h.dimensions.onTime },
    { dim: '合同', value: h.dimensions.contract },
  ];
  return (
    <ResponsiveContainer width="100%" height={180}>
      <RadarChart data={data} outerRadius={60}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        <Radar dataKey="value" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.25} />
        <Tooltip content={<ChartTooltipContent />} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function AnalyticsView() {
  const [dimension, setDimension] = useState<AnalyticsDimension>('school');
  const [metric, setMetric] = useState<AnalyticsMetric>('volume');
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const [health, setHealth] = useState<SchoolHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const [nlQuery, setNlQuery] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlResult, setNlResult] = useState<{ intent: string; count: number; rows: NLRow[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dim, h] = await Promise.all([
        apiFetch<AnalyticsResult>(
          `/api/analytics/dimension?dimension=${dimension}&metric=${metric}&limit=15`,
        ),
        apiFetch<SchoolHealth[]>('/api/analytics/school-health?limit=12'),
      ]);
      setResult(dim);
      setHealth(h);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载分析数据失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [dimension, metric]);

  useEffect(() => {
    void load();
  }, [load]);

  const runNL = useCallback(async () => {
    if (!nlQuery.trim()) return;
    setNlLoading(true);
    setNlResult(null);
    try {
      const data = await apiFetch<{ intent: string; count: number; rows: NLRow[] }>(
        '/api/analytics/nl-query',
        { method: 'POST', body: JSON.stringify({ query: nlQuery }) },
      );
      setNlResult(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '查询失败', { kind: 'error' });
    } finally {
      setNlLoading(false);
    }
  }, [nlQuery]);

  const chartData = useMemo(
    () =>
      (result?.rows ?? []).slice(0, 10).map((r) => ({
        name: r.label.length > 10 ? `${r.label.slice(0, 10)}…` : r.label,
        full: r.label,
        value:
          metric === 'ontime'
            ? r.onTimeRate == null
              ? 0
              : Math.round(r.onTimeRate * 100)
            : metric === 'score'
              ? r.avgScore == null
                ? 0
                : Number(r.avgScore.toFixed(2))
              : metric === 'trips'
                ? r.tripCount
                : r.total,
      })),
    [result, metric],
  );

  const suggestions = [
    '张三上个月去了哪些学校',
    '今年有哪些招投标逾期',
    'XX大学启明星交付了没',
    '近三个月评分低于3分的外出',
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<BarChart3 className="h-4 w-4" />}
        title="多维分析台"
        subtitle="按学校 / 行业 / 销售 / 产品 / 年度多维下钻业务数据，结合学校健康分与自然语言查询"
        breadcrumb={[{ label: '分析' }, { label: '多维分析' }]}
      />

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={dimension} onValueChange={(v) => setDimension(v as AnalyticsDimension)}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DIMENSION_LABEL) as AnalyticsDimension[]).map((d) => (
                <SelectItem key={d} value={d}>
                  维度：{DIMENSION_LABEL[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={metric} onValueChange={(v) => setMetric(v as AnalyticsMetric)}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(METRIC_LABEL) as AnalyticsMetric[]).map((m) => (
                <SelectItem key={m} value={m}>
                  指标：{METRIC_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-[11px] text-muted-foreground">
            维度：{DIMENSION_LABEL[dimension]} / 指标：{METRIC_LABEL[metric]}
          </span>
        </div>
      </div>

      <section className="rounded-md border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-brand" />
            {DIMENSION_LABEL[dimension]} Top 10 · {METRIC_LABEL[metric]}
          </h2>
        </header>
        <div className="h-72 p-3">
          {loading ? (
            <div className="h-full animate-pulse rounded bg-muted/40" />
          ) : chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={50}
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  content={<ChartTooltipContent />}
                  cursor={{ fill: 'var(--muted)', opacity: 0.25 }}
                  labelFormatter={(_, p) => p[0]?.payload?.full ?? ''}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="rounded-md border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <HeartPulse className="h-4 w-4 text-brand" />
            学校健康分
          </h2>
          <span className="text-[11px] text-muted-foreground">
            活跃度 · 满意度 · 转化 · 准时率 · 合同 五维加权
          </span>
        </header>
        {loading ? (
          <div className="p-5">
            <div className="h-40 animate-pulse rounded bg-muted/40" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 lg:grid-cols-3">
            {health.map((h) => (
              <Link
                key={h.schoolId}
                href={`/schools/${h.schoolId}`}
                className="group rounded-md border border-border bg-background p-3 transition hover:border-brand/40 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold group-hover:text-brand">
                      {h.schoolName}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                      近 180 天外出 {h.metrics.trips180d} 次
                      {h.lastVisit ? ` · 最近 ${h.lastVisit}` : ''}
                    </div>
                  </div>
                  <Badge tone={scoreTone(h.score)} className="font-mono">
                    {h.score}
                  </Badge>
                </div>
                <HealthRadar h={h} />
                <div className="grid grid-cols-3 gap-1 border-t border-border pt-2 text-center text-[10px] text-muted-foreground">
                  <span>招投标 {h.metrics.hasBidding ? '✓' : '—'}</span>
                  <span>建设 {h.metrics.hasDemand ? '✓' : '—'}</span>
                  <span>启明星 {h.metrics.hasQiming ? '✓' : '—'}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-md border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-brand" />
            自然语言查询
          </h2>
        </header>
        <div className="space-y-3 p-4">
          <div className="flex gap-2">
            <Input
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runNL();
              }}
              placeholder="例如：今年有哪些招投标逾期？"
              className="h-9"
            />
            <Button onClick={runNL} disabled={nlLoading} size="sm">
              <Search className="h-3.5 w-3.5" />
              {nlLoading ? '查询中…' : '查询'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setNlQuery(s)}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-brand/40 hover:text-brand"
              >
                {s}
              </button>
            ))}
          </div>

          {nlResult && (
            <div className="rounded-md border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px]">
                <span className="text-muted-foreground">意图：{nlResult.intent}</span>
                <span className="font-mono">{nlResult.count} 条结果</span>
              </div>
              {nlResult.rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">未匹配到记录</div>
              ) : (
                <ul className="divide-y divide-border">
                  {nlResult.rows.map((r) => (
                    <li key={r.id}>
                      <Link href={r.url} className="flex flex-col gap-0.5 px-4 py-2 text-xs hover:bg-muted/40">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium">{r.title}</span>
                          {r.status && <Badge tone="neutral">{r.status}</Badge>}
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                          {r.school && <span>{r.school}</span>}
                          {r.owner && <span>{r.owner}</span>}
                          {r.date && <span className="font-mono">{r.date}</span>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
