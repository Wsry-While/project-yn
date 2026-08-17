'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Plane,
  CheckCircle2,
  XCircle,
  Clock,
  UserRound,
  ShieldCheck,
  ExternalLink,
  Search,
  RefreshCw,
} from 'lucide-react';
import { tripWebService } from '@/lib/web/trip-web-service';
import { showToast } from '@/lib/web/toast-store';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/modal';
import type { TripOptionDict, TripRequest } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const APPROVAL_META: Record<
  TripRequest['approvalStatus'],
  { label: string; className: string; icon: typeof Clock }
> = {
  approved: { label: '已通过', className: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  rejected: { label: '已拒绝', className: 'text-red-500 bg-red-500/10 border-red-500/20', icon: XCircle },
  pending: { label: '待审批', className: 'text-amber-500 bg-amber-500/10 border-amber-500/20', icon: Clock },
};

function weekdayLabel(n: number | null): string {
  if (!n || n < 1 || n > 7) return '';
  return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][n - 1];
}

function formatDateTime(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatSyncedAt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function yesNo(v: boolean | null): string {
  if (v === true) return '是';
  if (v === false) return '否';
  return '—';
}

export function TripsView() {
  const [trips, setTrips] = useState<TripRequest[]>([]);
  const [options, setOptions] = useState<TripOptionDict[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<TripRequest | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [q, setQ] = useState('');

  const refresh = () => {
    setLoading(true);
    Promise.all([
      tripWebService.list({ limit: 200 }),
      tripWebService.options('support_type'),
    ])
      .then(([list, dict]) => {
        setTrips(list.rows);
        setOptions(dict);
      })
      .catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : '加载外出记录失败', { kind: 'error' });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return trips.filter((t) => {
      if (t.deletedAt) return false;
      if (filterType && t.supportType !== filterType) return false;
      if (!k) return true;
      return (
        t.schoolName.toLowerCase().includes(k) ||
        (t.salesManager?.name ?? '').toLowerCase().includes(k) ||
        (t.projectManager?.name ?? '').toLowerCase().includes(k) ||
        (t.detail?.text ?? '').toLowerCase().includes(k) ||
        t.supportType.toLowerCase().includes(k)
      );
    });
  }, [trips, q, filterType]);

  return (
    <LlmLoadingMask loading={loading} label="同步项目外出记录…" className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              chaoxing synced
            </div>
            <h1 className="text-xl font-semibold tracking-tight">项目外出</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              数据由超星表单推送驱动，共 {trips.length} 条记录；本页仅查看与筛选。
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground transition hover:text-foreground"
            aria-label="刷新"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            刷新
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative h-8 max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索学校、支持人员、事宜"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setFilterType('')}
              className={cn(
                'rounded-md border px-2 py-1 text-xs transition',
                !filterType
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              全部
            </button>
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilterType(opt.sourceValue)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs transition',
                  filterType === opt.sourceValue
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="hidden grid-cols-[1.4fr_.8fr_.9fr_.9fr_.7fr_.8fr] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
            <span>学校 / 事宜</span>
            <span>类型</span>
            <span>外出时间</span>
            <span>销售 / 项目经理</span>
            <span>状态</span>
            <span className="text-right">同步时间</span>
          </div>
          <div className="divide-y divide-border">
            {filtered.map((t) => {
              const meta = APPROVAL_META[t.approvalStatus];
              const Icon = meta.icon;
              return (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => setDetail(t)}
                  className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition hover:bg-muted/30 md:grid-cols-[1.4fr_.8fr_.9fr_.9fr_.7fr_.8fr] md:items-center md:gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{t.schoolName}</span>
                      {t.industry && (
                        <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground lg:inline">
                          {t.industry}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {t.detail?.text || '—'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                      <Plane className="h-3 w-3" />
                      {t.supportType}
                    </span>
                    {t.supportType === '其他' && t.supportTypeOther && (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {t.supportTypeOther}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    <div className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {t.tripDate}
                      {t.weekday ? ` ${weekdayLabel(t.weekday)}` : ''}
                    </div>
                    {(t.startAt || t.endAt) && (
                      <div className="mt-0.5 text-[11px]">
                        {formatDateTime(t.startAt)}–{formatDateTime(t.endAt)}
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    <div className="inline-flex items-center gap-1">
                      <UserRound className="h-3 w-3" />
                      {t.salesManager?.name ?? '未指派'}
                    </div>
                    <div className="mt-0.5 inline-flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      {t.projectManager?.name ?? '未指派'}
                    </div>
                  </div>

                  <span
                    className={cn(
                      'inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
                      meta.className,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </span>

                  <div className="text-right text-[11px] text-muted-foreground">
                    {formatSyncedAt(t.syncedAt)}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && !loading && (
              <div className="p-10 text-center text-sm text-muted-foreground">
                暂无项目外出记录
              </div>
            )}
          </div>
        </div>
      </div>

      <TripDetailModal trip={detail} onClose={() => setDetail(null)} />
    </LlmLoadingMask>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{children ?? '—'}</div>
    </div>
  );
}

function RichTextBlock({ value }: { value: TripRequest['detail'] }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  if (value.html) {
    return (
      <div
        className="prose prose-sm max-w-none rounded-md border border-border bg-muted/20 p-3 text-sm dark:prose-invert [&_a]:text-brand [&_li]:m-0 [&_ol]:pl-5 [&_p]:my-1 [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: value.html }}
      />
    );
  }
  return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{value.text}</p>;
}

function TripDetailModal({ trip, onClose }: { trip: TripRequest | null; onClose: () => void }) {
  const rawJson = useMemo(() => {
    if (!trip) return '';
    return JSON.stringify({ meta: trip.rawMeta, payload: trip.rawPayload }, null, 2);
  }, [trip]);

  return (
    <Modal
      open={!!trip}
      onClose={onClose}
      title={trip?.schoolName ?? '外出详情'}
      description={trip ? `${trip.tripDate} · ${trip.supportType}` : undefined}
      size="xl"
    >
      {trip && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <DetailRow label="编号">{trip.externalSerial ?? trip.externalId}</DetailRow>
            <DetailRow label="所属年度">{trip.year ?? '—'}</DetailRow>
            <DetailRow label="审批状态">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
                  APPROVAL_META[trip.approvalStatus].className,
                )}
              >
                {APPROVAL_META[trip.approvalStatus].label}
              </span>
            </DetailRow>
            <DetailRow label="学校">{trip.schoolName}</DetailRow>
            <DetailRow label="所属行业">{trip.industry ?? '—'}</DetailRow>
            <DetailRow label="支持类型">
              {trip.supportType}
              {trip.supportTypeOther ? `（${trip.supportTypeOther}）` : ''}
            </DetailRow>
            <DetailRow label="外出日期">
              {trip.tripDate} {weekdayLabel(trip.weekday)}
            </DetailRow>
            <DetailRow label="开始时间">{formatDateTime(trip.startAt) || '—'}</DetailRow>
            <DetailRow label="结束时间">{formatDateTime(trip.endAt) || '—'}</DetailRow>
            <DetailRow label="销售经理">{trip.salesManager?.name ?? '—'}</DetailRow>
            <DetailRow label="项目经理">{trip.projectManager?.name ?? '—'}</DetailRow>
            <DetailRow label="所属产品">
              {trip.products.length ? (
                <div className="flex flex-wrap gap-1">
                  {trip.products.map((p) => (
                    <span key={p} className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-xs">
                      {p}
                    </span>
                  ))}
                </div>
              ) : (
                '—'
              )}
            </DetailRow>
          </div>

          <DetailRow label="具体事宜">
            <RichTextBlock value={trip.detail} />
          </DetailRow>

          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              外出反馈
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <DetailRow label="是否完成">{yesNo(trip.isCompleted)}</DetailRow>
              <DetailRow label="汇报一致">{yesNo(trip.reportConsistent)}</DetailRow>
              <DetailRow label="销售迟到">{yesNo(trip.salesLate)}</DetailRow>
              <DetailRow label="服务迟到">{yesNo(trip.serviceLate)}</DetailRow>
              <DetailRow label="销售评分">{trip.salesScore ?? '—'}</DetailRow>
              <DetailRow label="综合评分">{trip.overallScore ?? '—'}</DetailRow>
              <DetailRow label="完成时间">{trip.completedAt ? formatSyncedAt(trip.completedAt) : '—'}</DetailRow>
            </div>
            <div className="mt-3 space-y-3">
              <DetailRow label="服务内容简述">
                <RichTextBlock value={trip.serviceSummary} />
              </DetailRow>
              <DetailRow label="整体评价/跟进">
                <RichTextBlock value={trip.overallFeedback} />
              </DetailRow>
            </div>
          </div>

          <details className="rounded-lg border border-border bg-muted/20 p-3">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
              超星同步元数据
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
              {rawJson}
            </pre>
          </details>
        </div>
      )}
    </Modal>
  );
}
