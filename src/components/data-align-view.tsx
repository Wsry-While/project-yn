'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  EyeOff,
  GitBranch,
  RefreshCw,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AlignQueueItem, AlignStatus, AlignSummary } from '@/lib/domain/data-align-service';

const STATUS_LABEL: Record<AlignStatus, { label: string; tone: 'warning' | 'success' | 'neutral' }> = {
  pending: { label: '待处理', tone: 'warning' },
  resolved: { label: '已处理', tone: 'success' },
  ignored: { label: '已忽略', tone: 'neutral' },
};

export function DataAlignView() {
  const [summary, setSummary] = useState<AlignSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'all' | AlignStatus>('pending');
  const [entityType, setEntityType] = useState<'all' | string>('all');
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status !== 'all') qs.set('status', status);
      if (entityType !== 'all') qs.set('entityType', entityType);
      const data = await apiFetch<AlignSummary>(`/api/data-align?${qs.toString()}`);
      setSummary(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载数据对齐队列失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [status, entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (id: string, newStatus: AlignStatus) => {
      setProcessing(id);
      try {
        await apiFetch(`/api/data-align/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus, note: newStatus === 'ignored' ? '已忽略' : '已处理' }),
        });
        showToast(newStatus === 'resolved' ? '已标记处理' : '已忽略', { kind: 'success' });
        void load();
      } catch (err) {
        showToast(err instanceof Error ? err.message : '操作失败', { kind: 'error' });
      } finally {
        setProcessing(null);
      }
    },
    [load],
  );

  const total = summary?.total ?? 0;
  const pending = summary?.pending ?? 0;
  const resolved = summary?.resolved ?? 0;
  const ignored = summary?.ignored ?? 0;

  const items = useMemo(() => summary?.items ?? [], [summary]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<GitBranch className="h-4 w-4" />}
        title="数据对齐"
        subtitle="字典未命中、学校别名冲突、人员未匹配等需人工复核的数据排队在此统一处理"
        breadcrumb={[{ label: '设置' }, { label: '数据对齐' }]}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="总记录" value={total} icon={<GitBranch className="h-4 w-4" />} tone="neutral" />
        <KpiCard label="待处理" value={pending} icon={<Clock className="h-4 w-4" />} tone="warning" />
        <KpiCard label="已处理" value={resolved} icon={<CheckCircle2 className="h-4 w-4" />} tone="success" />
        <KpiCard label="已忽略" value={ignored} icon={<EyeOff className="h-4 w-4" />} tone="info" />
      </div>

      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending">待处理</SelectItem>
              <SelectItem value="resolved">已处理</SelectItem>
              <SelectItem value="ignored">已忽略</SelectItem>
            </SelectContent>
          </Select>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="所有实体" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有实体</SelectItem>
              {(summary?.byEntityType ?? []).map((e) => (
                <SelectItem key={e.entityType} value={e.entityType}>
                  {e.entityType} ({e.pending})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-[11px] text-muted-foreground">
            显示 {items.length} 条
          </span>
        </div>
      </div>

      {loading || !summary ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card py-16 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-status-success/60" />
          当前筛选条件下没有需要处理的数据
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {items.map((it: AlignQueueItem) => {
            const st = STATUS_LABEL[it.status];
            return (
              <li key={it.id} className="px-5 py-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral" className="font-mono">
                        {it.entityType}
                      </Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">{it.field}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="font-mono text-[10px] text-muted-foreground/70">
                        {new Date(it.createdAt).toLocaleString('zh-CN', { hour12: false })}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="text-muted-foreground">原始值：</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
                        {it.rawValue ?? '—'}
                      </code>
                    </div>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">原因：{it.reason}</p>
                    {it.resolutionNote && (
                      <p className="mt-0.5 text-[11px] italic text-muted-foreground/80">
                        处理备注：{it.resolutionNote}
                      </p>
                    )}
                  </div>
                  {it.status === 'pending' && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => act(it.id, 'ignored')}
                        disabled={processing === it.id}
                      >
                        <EyeOff className="h-3 w-3" />
                        忽略
                      </Button>
                      <Button size="sm" onClick={() => act(it.id, 'resolved')} disabled={processing === it.id}>
                        <CheckCircle2 className="h-3 w-3" />
                        标记已处理
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
