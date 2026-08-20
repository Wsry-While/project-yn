'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Inbox,
  Plane,
  FileText,
  ClipboardList,
  Star,
  CalendarDays,
  UserCheck,
  Briefcase,
  AlertTriangle,
} from 'lucide-react';
import { workbenchWebService, type MyWorkbench, type WorkbenchItem, type WorkbenchSource } from '@/lib/web/workbench-web-service';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { PageHeader } from '@/components/page-header';
import { KpiCard } from '@/components/kpi-card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const SOURCE_META: Record<WorkbenchSource, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  trip: { label: '项目外出', icon: Plane },
  bidding: { label: '招投标', icon: FileText },
  demand: { label: '建设申请', icon: ClipboardList },
  qiming: { label: '启明星', icon: Star },
};

type BucketKey = 'all' | 'overdue' | 'today' | 'week' | 'later';
const BUCKET_TABS: Array<{ key: BucketKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'overdue', label: '已逾期' },
  { key: 'today', label: '今日到期' },
  { key: 'week', label: '7 天内' },
  { key: 'later', label: '以后' },
];

function formatTitle(t: string): string {
  const idx = t.indexOf(' · ');
  return idx === -1 ? t : t.slice(idx + 3);
}

function WorkbenchRow({ item, focus }: { item: WorkbenchItem; focus?: boolean }) {
  const meta = SOURCE_META[item.source];
  const overdue = item.date && new Date(item.date).getTime() < new Date(new Date().toDateString()).getTime();
  return (
    <Link
      href={item.url}
      className={cn(
        'grid grid-cols-[80px_1fr_120px_90px_90px] items-center gap-3 border-b border-border/60 px-4 py-2.5 text-sm transition-colors last:border-b-0 hover:bg-brand/5',
        focus && 'bg-brand/5 ring-1 ring-inset ring-brand/30',
      )}
    >
      <span className="flex items-center gap-1.5">
        <meta.icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{meta.label}</span>
      </span>
      <span className="min-w-0 truncate font-medium text-foreground/90">{formatTitle(item.title)}</span>
      <span className="min-w-0 truncate text-xs text-muted-foreground">{item.school ?? '—'}</span>
      <span>
        {item.role === 'sales' ? (
          <Badge tone="brand"><Briefcase className="h-2.5 w-2.5" />销售</Badge>
        ) : (
          <Badge tone="info"><UserCheck className="h-2.5 w-2.5" />PM</Badge>
        )}
      </span>
      <span
        className={cn(
          'text-right font-mono text-xs tabular-nums',
          overdue ? 'text-status-danger' : 'text-muted-foreground',
        )}
      >
        {item.date ? item.date.slice(0, 10) : '—'}
      </span>
    </Link>
  );
}

export function WorkbenchView() {
  const [data, setData] = useState<MyWorkbench | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<BucketKey>('all');
  const [source, setSource] = useState<WorkbenchSource | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    workbenchWebService
      .mine()
      .then((d) => !cancelled && setData(d))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const allItems = useMemo(() => {
    if (!data) return [];
    return [
      ...data.items.overdue,
      ...data.items.today,
      ...data.items.week,
      ...data.items.later,
    ];
  }, [data]);

  const filtered = useMemo(() => {
    let arr = allItems;
    if (tab !== 'all') arr = data?.items[tab as Exclude<BucketKey, 'all'>] ?? [];
    if (source !== 'all') arr = arr.filter((i) => i.source === source);
    return arr;
  }, [allItems, data, tab, source]);

  return (
    <LlmLoadingMask loading={loading} label="加载工作台…" className="min-h-[70vh]">
      <PageHeader
        icon={Inbox}
        title="我的工作台"
        subtitle={data?.member ? `${data.member.name} · 跨四大业务源的个人待办` : '跨四大业务源的个人待办'}
        breadcrumb={[{ label: '工作台' }, { label: '我的工作台' }]}
      />
      <div className="mx-auto w-full max-w-7xl space-y-4 p-6">
        {!data?.member ? (
          <div className="rounded-md border border-dashed border-border bg-card p-10 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium text-foreground/80">尚未匹配到你的员工档案</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data?.selfUid ? `当前超星 UID：${data.selfUid}。` : '未获取到超星 UID。'}
              等业务推送一条你参与的工单后即可自动关联；若已有参与工单仍看不到，请联系管理员在「团队」中补全该 UID。
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="待办总数" value={data.counts.total} icon={Inbox} tone="brand" unit="条" />
              <KpiCard label="已逾期" value={data.counts.overdue} icon={AlertTriangle} tone="danger" unit="条" />
              <KpiCard label="今日到期" value={data.counts.today} icon={CalendarDays} tone="warning" unit="条" />
              <KpiCard label="7 天内" value={data.counts.week} icon={Plane} tone="brand" unit="条" />
            </div>

            <div className="rounded-md border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-1">
                  {BUCKET_TABS.map((t) => {
                    const count =
                      t.key === 'all'
                        ? data?.counts.total ?? 0
                        : data?.counts[t.key as Exclude<BucketKey, 'all'>] ?? 0;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setTab(t.key)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors',
                          tab === t.key
                            ? 'bg-brand/10 text-brand'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {t.label}
                        <span className={cn('font-mono text-[10px]', tab === t.key ? 'text-brand' : 'text-muted-foreground/70')}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSource('all')}
                    className={cn(
                      'rounded px-2 py-0.5 text-[11px] transition-colors',
                      source === 'all' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    全部
                  </button>
                  {(Object.keys(SOURCE_META) as WorkbenchSource[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSource(s)}
                      className={cn(
                        'rounded px-2 py-0.5 text-[11px] transition-colors',
                        source === s ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {SOURCE_META[s].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hidden grid-cols-[80px_1fr_120px_90px_90px] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:grid">
                <span>来源</span>
                <span>标题</span>
                <span>学校/单位</span>
                <span>角色</span>
                <span className="text-right">日期</span>
              </div>
              {filtered.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  <Inbox className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-2">没有匹配的待办</p>
                </div>
              ) : (
                <div>
                  {filtered.map((it) => (
                    <WorkbenchRow key={`${it.source}-${it.id}`} item={it} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </LlmLoadingMask>
  );
}
