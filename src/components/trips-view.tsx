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
  Undo2,
} from 'lucide-react';
import { tripWebService } from '@/lib/web/trip-web-service';
import { showToast } from '@/lib/web/toast-store';
import { exportCsv, datedName } from '@/lib/web/csv-export';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Modal } from '@/components/modal';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TripOptionDict, TripRequest } from '@/lib/domain/types';
import { useServerPaginatedList } from '@/hooks/use-server-paginated-list';
import { ListContainer, ListBody, ListEmpty } from '@/components/list-container';
import { ListToolbar } from '@/components/list-toolbar';
import { cn } from '@/lib/utils';

interface TripFilters extends Record<string, string> {
  search: string;
  supportType: string;
}

export function TripsView() {
  const [options, setOptions] = useState<TripOptionDict[]>([]);
  const [detail, setDetail] = useState<TripRequest | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const list = useServerPaginatedList<TripRequest, TripFilters>({
    endpoint: '/api/trips',
    pageSize: 20,
    initialFilters: { search: '', supportType: '' },
    errorMessage: '加载项目外出记录失败',
  });

  const refresh = () => {
    list.refresh();
    tripWebService
      .options('support_type')
      .then(setOptions)
      .catch(() => undefined);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focus');
    if (focus) setFocusId(focus);
  }, []);

  // 详情弹窗数据随列表刷新同步（附件转存状态等）
  useEffect(() => {
    if (!detail) return;
    const fresh = list.rows.find((r) => r.id === detail.id);
    if (fresh) setDetail(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.rows]);

  const handleExport = async () => {
    try {
      const all = await list.fetchAll();
      if (!all.length) {
        showToast('当前筛选结果为空，无法导出', { kind: 'info' });
        return;
      }
      exportCsv(datedName('项目外出'), [
        { header: '学校', get: (r) => r.schoolName },
        { header: '行业', get: (r) => r.industry },
        { header: '年度', get: (r) => r.year },
        { header: '支持类型', get: (r) => r.supportType },
        { header: '其他类型', get: (r) => r.supportTypeOther },
        { header: '产品', get: (r) => r.products.join('、') },
        { header: '外出日期', get: (r) => r.tripDate?.slice(0, 10) },
        { header: '开始时间', get: (r) => (r.startAt ? formatDateTime(r.startAt) : '') },
        { header: '结束时间', get: (r) => (r.endAt ? formatDateTime(r.endAt) : '') },
        { header: '销售经理', get: (r) => r.salesManager?.name },
        { header: '项目经理', get: (r) => r.projectManager?.name },
        { header: '是否完成', get: (r) => (r.isCompleted ? '是' : '否') },
        { header: '综合评分', get: (r) => r.overallScore },
        { header: '销售评分', get: (r) => r.salesScore },
        { header: '整体评价', get: (r) => r.overallFeedback?.text },
        { header: '服务内容', get: (r) => r.serviceSummary?.text },
        { header: '事宜', get: (r) => r.detail?.text },
      ], all);
      showToast(`已导出 ${all.length} 条项目外出记录`, { kind: 'success' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败', { kind: 'error' });
    }
  };

  return (
    <LlmLoadingMask loading={list.loading} label="同步项目外出记录…" className="min-h-[70vh]">
      <ListContainer>
        <PageHeader
          icon={Plane}
          title="项目外出"
          subtitle={`数据由超星表单推送驱动，共 ${list.total} 条记录；本页仅查看与筛选。`}
          breadcrumb={[{ label: '工作台' }, { label: '项目外出' }]}
        />
        <ListToolbar
          search={{
            value: list.searchInput,
            onChange: list.setSearchInput,
            placeholder: '搜索学校、支持人员、事宜',
          }}
          filters={
            <Select
              value={list.filters.supportType || '__all__'}
              onValueChange={(v) => list.setFilter('supportType', v === '__all__' ? '' : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="支持类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部支持类型</SelectItem>
                {options.map((opt) => (
                  <SelectItem key={opt.id} value={opt.sourceValue}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          onRefresh={refresh}
          refreshing={list.loading}
          onExport={handleExport}
          exportDisabled={list.total === 0}
          total={list.total}
        />

        <div className="hidden grid-cols-[1.4fr_.8fr_.9fr_.9fr_.7fr_.8fr] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
          <span>学校 / 事宜</span>
          <span>类型</span>
          <span>外出时间</span>
          <span>销售 / 项目经理</span>
          <span>状态</span>
          <span className="text-right">同步时间</span>
        </div>
        <ListBody>
          {list.rows.map((t) => {
            const meta = APPROVAL_META[t.approvalStatus];
            const Icon = meta.icon;
            const isFocus = focusId === t.id;
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => setDetail(t)}
                className={cn(
                  'grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition hover:bg-muted/30 md:grid-cols-[1.4fr_.8fr_.9fr_.9fr_.7fr_.8fr] md:items-center md:gap-3',
                  isFocus && 'bg-brand/5 ring-1 ring-inset ring-brand/40',
                )}
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

                <Badge tone={APPROVAL_TONE[t.approvalStatus]} dot>
                  {Icon ? <Icon className="h-3 w-3" /> : null}
                  {meta.label}
                </Badge>

                <div className="text-right text-[11px] text-muted-foreground">
                  {formatSyncedAt(t.syncedAt)}
                </div>
              </button>
            );
          })}
          {list.rows.length === 0 && !list.loading && <ListEmpty>暂无项目外出记录</ListEmpty>}
        </ListBody>
        {list.totalPages > 1 && (
          <Pagination
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPageChange={list.setPage}
          />
        )}
      </ListContainer>

      <TripDetailModal trip={detail} onClose={() => setDetail(null)} />
    </LlmLoadingMask>
  );
}

const APPROVAL_TONE = {
  approved: 'success',
  rejected: 'danger',
  pending: 'warning',
  revoked: 'neutral',
} as const;

const APPROVAL_META = {
  approved: { label: '已通过', icon: CheckCircle2 },
  rejected: { label: '已拒绝', icon: XCircle },
  pending: { label: '待审批', icon: Clock },
  revoked: { label: '已撤销', icon: Undo2 },
} as const;

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
              <Badge tone={APPROVAL_TONE[trip.approvalStatus]} dot>
                {APPROVAL_META[trip.approvalStatus].label}
              </Badge>
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

function yesNo(v: boolean | null): string {
  if (v === true) return '是';
  if (v === false) return '否';
  return '—';
}
