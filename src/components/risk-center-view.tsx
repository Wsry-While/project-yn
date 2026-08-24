'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Filter,
  Gauge,
  Info,
  RefreshCw,
  ShieldAlert,
  User,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/kpi-card';
import { PageHeader } from '@/components/page-header';
import type { RiskItem, RiskSeverity, RiskSummary } from '@/lib/domain/risk-service';

const SEVERITY_TONE: Record<RiskSeverity, { label: string; dot: string; text: string; bg: string; border: string }> = {
  high: { label: '高', dot: 'bg-status-danger', text: 'text-status-danger', bg: 'bg-status-danger/10', border: 'border-status-danger/30' },
  medium: { label: '中', dot: 'bg-status-warning', text: 'text-status-warning', bg: 'bg-status-warning/10', border: 'border-status-warning/30' },
  info: { label: '洞察', dot: 'bg-brand', text: 'text-brand', bg: 'bg-brand/10', border: 'border-brand/30' },
};

const SOURCE_LABEL: Record<RiskItem['source'], string> = {
  bidding: '招投标',
  demand: '建设申请',
  qiming: '启明星',
  trip: '项目外出',
  cross: '跨源',
};

function RiskSkeleton() {
  return (
    <div className="divide-y divide-border rounded-md border border-border bg-card">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-[74px] animate-pulse px-5 py-4">
          <div className="h-3 w-48 rounded bg-muted" />
          <div className="mt-2 h-2 w-72 rounded bg-muted/70" />
        </div>
      ))}
    </div>
  );
}

export function RiskCenterView() {
  const [summary, setSummary] = useState<RiskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<'all' | RiskSeverity>('all');
  const [source, setSource] = useState<'all' | RiskItem['source']>('all');
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (mine) qs.set('mine', '1');
      const data = await apiFetch<RiskSummary>(`/api/risks${qs.size ? `?${qs.toString()}` : ''}`);
      setSummary(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载风险预警失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [mine]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!summary) return [];
    const kw = search.trim().toLowerCase();
    return summary.items.filter((it) => {
      if (severity !== 'all' && it.severity !== severity) return false;
      if (source !== 'all' && it.source !== source) return false;
      if (!kw) return true;
      return (
        it.title.toLowerCase().includes(kw) ||
        it.detail.toLowerCase().includes(kw) ||
        (it.school ?? '').toLowerCase().includes(kw) ||
        (it.owner ?? '').toLowerCase().includes(kw)
      );
    });
  }, [summary, severity, source, search]);

  const countsBySource = useMemo(() => {
    if (!summary) return null;
    return summary.bySource;
  }, [summary]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<ShieldAlert className="h-4 w-4" />}
        title="风险预警中心"
        subtitle="跨招投标 / 建设申请 / 启明星 / 项目外出四源，自动识别逾期、未签合同、低评分等业务风险"
        breadcrumb={[{ label: '工作台' }, { label: '风险预警' }]}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="风险总数"
          value={summary?.total ?? '—'}
          icon={<Gauge className="h-4 w-4" />}
          tone="neutral"
          hint="跨四源自动识别"
        />
        <KpiCard
          label="高危"
          value={summary?.high ?? '—'}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="danger"
          hint="需立即处理"
        />
        <KpiCard
          label="中危"
          value={summary?.medium ?? '—'}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="warning"
          hint="本周关注"
        />
        <KpiCard
          label="业务洞察"
          value={summary?.info ?? '—'}
          icon={<Info className="h-4 w-4" />}
          tone="brand"
          hint="销售机会 / 异常"
        />
      </div>

      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题 / 学校 / 负责人"
            className="h-8 w-56"
          />
          <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部等级</SelectItem>
              <SelectItem value="high">高危</SelectItem>
              <SelectItem value="medium">中危</SelectItem>
              <SelectItem value="info">洞察</SelectItem>
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部来源</SelectItem>
              <SelectItem value="bidding">招投标</SelectItem>
              <SelectItem value="demand">建设申请</SelectItem>
              <SelectItem value="qiming">启明星</SelectItem>
              <SelectItem value="trip">项目外出</SelectItem>
              <SelectItem value="cross">跨源</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={mine ? 'default' : 'outline'}
            size="sm"
            className="h-8"
            onClick={() => setMine((v) => !v)}
          >
            <User className="h-3.5 w-3.5" />
            我的风险
          </Button>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
            {countsBySource && (
              <>
                <span>招投标 {countsBySource.bidding}</span>
                <span className="text-border">·</span>
                <span>建设 {countsBySource.demand}</span>
                <span className="text-border">·</span>
                <span>启明星 {countsBySource.qiming}</span>
                <span className="text-border">·</span>
                <span>外出 {countsBySource.trip}</span>
                <span className="text-border">·</span>
                <span>跨源 {countsBySource.cross}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {loading || !summary ? (
        <RiskSkeleton />
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          <ShieldAlert className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
          当前筛选条件下暂无风险记录
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {filtered.map((it) => {
            const tone = SEVERITY_TONE[it.severity];
            return (
              <li key={it.id}>
                <Link
                  href={it.url}
                  className={cn(
                    'flex flex-col gap-2 px-5 py-3 transition hover:bg-muted/40 md:flex-row md:items-start md:gap-4',
                  )}
                >
                  <span className={cn('mt-0.5 inline-flex h-6 w-12 shrink-0 items-center justify-center rounded-sm text-[11px] font-medium', tone.bg, tone.text, tone.border, 'border')}>
                    <span className={cn('mr-1 h-1.5 w-1.5 rounded-full', tone.dot)} />
                    {tone.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        {SOURCE_LABEL[it.source]}
                      </span>
                      <span className="text-[11px] text-muted-foreground">·</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{it.ruleCode}</span>
                      <h4 className="text-[13px] font-medium text-foreground">{it.title}</h4>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{it.detail}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
                      {it.school && <span>学校：{it.school}</span>}
                      {it.owner && (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {it.owner}
                        </span>
                      )}
                      {it.date && <span className="font-mono">{it.date.slice(0, 10)}</span>}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
