'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Paperclip,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react';
import { biddingScreenshotWebService } from '@/lib/web/bidding-screenshot-web-service';
import { showToast } from '@/lib/web/toast-store';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Input } from '@/components/ui/input';
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
import type { BiddingFileRef, BiddingScreenshot } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

type BadgeTone = 'success' | 'warning' | 'brand' | 'neutral' | 'danger';
const STATUS_TONE: Record<string, BadgeTone> = {
  已完成: 'success',
  已交付: 'success',
  待交付: 'warning',
  处理中: 'brand',
};

function statusMeta(status: string | null): { label: string; tone: BadgeTone } {
  if (status && STATUS_TONE[status]) return { label: status, tone: STATUS_TONE[status] };
  return { label: status || '待处理', tone: 'neutral' };
}

function isOverdue(row: BiddingScreenshot): boolean {
  if (!row.dueDeliveryDate) return false;
  if (row.completionStatus === '已完成' || row.completionStatus === '已交付') return false;
  const today = new Date().toISOString().slice(0, 10);
  return row.dueDeliveryDate < today;
}

function storageStatusBadge(file: BiddingFileRef): { label: string; className: string } | null {
  switch (file.storageStatus) {
    case 'pending':
      return { label: '待转存', className: 'bg-zinc-500/10 text-zinc-500' };
    case 'fetching':
      return { label: '转存中', className: 'bg-brand/10 text-brand' };
    case 'failed':
      return { label: '转存失败', className: 'bg-red-500/10 text-red-500' };
    case 'stored':
    default:
      return null;
  }
}

function FileLink({ file, label }: { file: BiddingFileRef | null; label: string }) {
  if (!file) return <span className="text-muted-foreground">—</span>;
  const badge = storageStatusBadge(file);
  const downloadHref = file.assetId ? `/api/files/attachments/${file.assetId}` : file.url;
  const downloadable = !!downloadHref && file.storageStatus !== 'failed';
  const inner = (
    <>
      <FileText className="h-3.5 w-3.5" />
      <span className="truncate">{file.name || label}</span>
      {badge ? (
        <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge.className}`}>
          {badge.label}
        </span>
      ) : null}
    </>
  );
  if (downloadable) {
    return (
      <a
        href={downloadHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex max-w-full items-center gap-1 text-sm text-brand hover:underline"
      >
        {inner}
      </a>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1 text-sm text-muted-foreground" title={file.storageError ?? undefined}>
      {inner}
    </span>
  );
}

function AttachmentList({ files }: { files: BiddingFileRef[] }) {
  if (!files.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {files.map((file, i) => {
        const badge = storageStatusBadge(file);
        const href = file.assetId ? `/api/files/attachments/${file.assetId}` : file.url;
        const downloadable = !!href && file.storageStatus !== 'failed';
        const inner = (
          <>
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{file.name || `附件 ${i + 1}`}</span>
            {badge ? (
              <span className={`ml-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge.className}`}>
                {badge.label}
              </span>
            ) : null}
          </>
        );
        return downloadable ? (
          <a
            key={`${file.objectId ?? file.assetId ?? file.url ?? i}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-sm text-brand hover:underline"
          >
            {inner}
          </a>
        ) : (
          <span
            key={`${file.objectId ?? file.assetId ?? i}`}
            className="inline-flex max-w-full items-center gap-1 text-sm text-muted-foreground"
            title={file.storageError ?? undefined}
          >
            {inner}
          </span>
        );
      })}
    </div>
  );
}

export function BiddingScreenshotsView() {
  const [rows, setRows] = useState<BiddingScreenshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<BiddingScreenshot | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [focusId, setFocusId] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    biddingScreenshotWebService
      .list({ limit: 200 })
      .then((res) => setRows(res.rows))
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : '加载招投标截图失败', { kind: 'error' }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focus');
    if (focus) setFocusId(focus);
  }, []);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (row.deletedAt) return false;
      if (status && row.completionStatus !== status) return false;
      if (overdueOnly && !isOverdue(row)) return false;
      if (!k) return true;
      return [row.projectName, row.projectSchool, row.salesManager, row.assignedProjectManager, row.projectCategory?.join(' ')]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(k));
    });
  }, [rows, q, status, overdueOnly]);

  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.completionStatus).filter((v): v is string => !!v))),
    [rows],
  );

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [safePage, page]);

  return (
    <LlmLoadingMask loading={loading} label="加载招投标截图…" className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">
        <PageHeader
          icon={FileText}
          title="招投标截图"
          subtitle={`数据由第三方系统推送，共 ${rows.length} 条，系统内仅查看与筛选。`}
          breadcrumb={[{ label: '工作台' }, { label: '招投标截图' }]}
          actions={
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </button>
          }
        />

        <div className="rounded-b-md border border-t-0 border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="relative h-8 min-w-[220px] flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索项目、学校、销售"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <Select
              value={status || '__all__'}
              onValueChange={(v) => {
                setStatus(v === '__all__' ? '' : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="完成状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => {
                setOverdueOnly((v) => !v);
                setPage(1);
              }}
              className={cn(
                'h-8 rounded-md border px-2.5 text-xs transition',
                overdueOnly
                  ? 'border-status-danger/40 bg-status-danger/10 text-status-danger'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              仅逾期
            </button>
            <div className="ml-auto font-mono text-[11px] text-muted-foreground">
              筛选结果 <span className="text-foreground">{total}</span>
            </div>
          </div>

          <div className="hidden grid-cols-[1.4fr_1fr_.9fr_.9fr_.8fr_.8fr] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
            <span>项目 / 学校</span>
            <span>销售 / 项目经理</span>
            <span>提交 / 截止</span>
            <span>类别 / 文件</span>
            <span>状态</span>
            <span className="text-right">预留天数</span>
          </div>
          <div className="divide-y divide-border">
            {paged.map((row) => {
              const meta = statusMeta(row.completionStatus);
              const overdue = isOverdue(row);
              const isFocus = focusId === row.id;
              return (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => setDetail(row)}
                  className={cn(
                    'grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition hover:bg-muted/30 lg:grid-cols-[1.4fr_1fr_.9fr_.9fr_.8fr_.8fr] lg:items-center lg:gap-3',
                    isFocus && 'bg-brand/5 ring-1 ring-inset ring-brand/40',
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{row.projectName}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{row.projectSchool}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{row.salesManager}</div>
                    <div className="mt-0.5">{row.assignedProjectManager || '未指派'}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div>提交 {row.submissionDate}</div>
                    <div
                      className={cn(
                        'mt-0.5 inline-flex items-center gap-1',
                        overdue && 'text-status-danger',
                      )}
                    >
                      <CalendarClock className="h-3 w-3" />
                      {row.dueDeliveryDate || '—'}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div>{row.projectCategory?.length ? row.projectCategory.join('、') : '—'}</div>
                    <div className="mt-0.5">{row.projectBiddingFile ? '含招标文件' : '无招标文件'}</div>
                  </div>
                  <Badge tone={meta.tone} dot={overdue && meta.tone !== 'danger'}>
                    {row.completionStatus === '已完成' || row.completionStatus === '已交付' ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <Clock className="h-3 w-3" />
                    )}
                    {meta.label}
                  </Badge>
                  <div className="text-right text-xs text-muted-foreground">
                    {row.reservedDays ?? '—'} 天
                  </div>
                </button>
              );
            })}
            {paged.length === 0 && !loading && (
              <div className="p-10 text-center text-sm text-muted-foreground">暂无招投标截图记录</div>
            )}
          </div>
          {total > PAGE_SIZE && (
            <Pagination page={safePage} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          )}
        </div>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.projectName ?? '招投标截图详情'} description={detail?.projectSchool} size="xl">
        {detail && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Detail label="销售经理">{detail.salesManager}</Detail>
              <Detail label="项目经理">{detail.assignedProjectManager || '—'}</Detail>
              <Detail label="所属学校">{detail.projectSchool}</Detail>
              <Detail label="二级单位">{detail.projectSecondaryUnit || '—'}</Detail>
              <Detail label="项目类别">{detail.projectCategory?.length ? detail.projectCategory.join('、') : '—'}</Detail>
              <Detail label="公司参数">{detail.isCompanyParameter ? '是' : '否'}</Detail>
              <Detail label="提交日期">{detail.submissionDate}</Detail>
              <Detail label="需交付日期">{detail.dueDeliveryDate || '—'}</Detail>
              <Detail label="预留天数">{detail.reservedDays ?? '—'}</Detail>
              <Detail label="完成情况">{detail.completionStatus || '—'}</Detail>
              <Detail label="按需求完成">{detail.isMeetScreenshotRequirement === null ? '—' : detail.isMeetScreenshotRequirement ? '是' : '否'}</Detail>
              <Detail label="附件数">{detail.attachments.length}</Detail>
            </div>
            <Detail label="截图需求说明">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.screenshotRequirement || '—'}</p>
            </Detail>
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="项目招标文件"><FileLink file={detail.projectBiddingFile} label="项目招标文件" /></Detail>
              <Detail label="交付文档上传"><FileLink file={detail.deliveryDocument} label="交付文档" /></Detail>
              <Detail label="整改后文档"><FileLink file={detail.rectifiedDocument} label="整改后文档" /></Detail>
              <Detail label="附件材料"><AttachmentList files={detail.attachments} /></Detail>
            </div>
            <Detail label="交付信息备注">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.deliveryRemark || '—'}</p>
            </Detail>
            <Detail label="销售反馈意见">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.salesFeedback || '—'}</p>
            </Detail>
            <Detail label="整改情况反馈">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail.rectificationFeedback || '—'}</p>
            </Detail>
          </div>
        )}
      </Modal>
    </LlmLoadingMask>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{children ?? '—'}</div>
    </div>
  );
}
