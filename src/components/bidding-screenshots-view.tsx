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
import type { BiddingFileRef, BiddingScreenshot } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const STATUS_META: Record<string, { label: string; className: string }> = {
  已完成: { label: '已完成', className: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
  已交付: { label: '已交付', className: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
  待交付: { label: '待交付', className: 'text-amber-500 bg-amber-500/10 border-amber-500/20' },
  处理中: { label: '处理中', className: 'text-brand bg-brand/10 border-brand/20' },
};

function statusMeta(status: string | null) {
  if (status && STATUS_META[status]) return STATUS_META[status];
  return { label: status || '待处理', className: 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20' };
}

function isOverdue(row: BiddingScreenshot): boolean {
  if (!row.dueDeliveryDate) return false;
  if (row.completionStatus === '已完成' || row.completionStatus === '已交付') return false;
  const today = new Date().toISOString().slice(0, 10);
  return row.dueDeliveryDate < today;
}

function FileLink({ file, label }: { file: BiddingFileRef | null; label: string }) {
  if (!file?.url) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
    >
      <FileText className="h-3.5 w-3.5" />
      {file.name || label}
    </a>
  );
}

function AttachmentList({ files }: { files: BiddingFileRef[] }) {
  if (!files.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {files.map((file, i) => (
        <a
          key={`${file.url}-${i}`}
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm text-brand hover:underline"
        >
          <Paperclip className="h-3.5 w-3.5" />
          {file.name || `附件 ${i + 1}`}
        </a>
      ))}
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

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (row.deletedAt) return false;
      if (status && row.completionStatus !== status) return false;
      if (overdueOnly && !isOverdue(row)) return false;
      if (!k) return true;
      return [row.projectName, row.projectSchool, row.salesManager, row.assignedProjectManager, row.projectCategory]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(k));
    });
  }, [rows, q, status, overdueOnly]);

  const statusOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.completionStatus).filter((v): v is string => !!v))),
    [rows],
  );

  return (
    <LlmLoadingMask loading={loading} label="加载招投标截图…" className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              third-party synced
            </div>
            <h1 className="text-xl font-semibold tracking-tight">招投标截图</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              数据由第三方系统推送，共 {rows.length} 条，系统内仅查看与筛选。
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            刷新
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative h-8 max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索项目、学校、销售" className="h-8 pl-8 text-sm" />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-8 rounded-md border border-border bg-input px-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            <option value="">全部状态</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setOverdueOnly((v) => !v)}
            className={cn(
              'rounded-md border px-2 py-1 text-xs transition',
              overdueOnly ? 'border-red-500/40 bg-red-500/10 text-red-500' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            仅逾期
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="hidden grid-cols-[1.4fr_1fr_.9fr_.9fr_.8fr_.8fr] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
            <span>项目 / 学校</span>
            <span>销售 / 项目经理</span>
            <span>提交 / 截止</span>
            <span>类别 / 文件</span>
            <span>状态</span>
            <span className="text-right">预留天数</span>
          </div>
          <div className="divide-y divide-border">
            {filtered.map((row) => {
              const meta = statusMeta(row.completionStatus);
              const overdue = isOverdue(row);
              return (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => setDetail(row)}
                  className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition hover:bg-muted/30 lg:grid-cols-[1.4fr_1fr_.9fr_.9fr_.8fr_.8fr] lg:items-center lg:gap-3"
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
                    <div className={cn('mt-0.5 inline-flex items-center gap-1', overdue && 'text-red-500')}>
                      <CalendarClock className="h-3 w-3" />
                      {row.dueDeliveryDate || '—'}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div>{row.projectCategory || '—'}</div>
                    <div className="mt-0.5">{row.projectBiddingFile ? '含招标文件' : '无招标文件'}</div>
                  </div>
                  <span className={cn('inline-flex w-fit items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium', meta.className)}>
                    {row.completionStatus === '已完成' || row.completionStatus === '已交付' ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                    {meta.label}
                  </span>
                  <div className="text-right text-xs text-muted-foreground">{row.reservedDays ?? '—'} 天</div>
                </button>
              );
            })}
            {filtered.length === 0 && !loading && (
              <div className="p-10 text-center text-sm text-muted-foreground">暂无招投标截图记录</div>
            )}
          </div>
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
              <Detail label="项目类别">{detail.projectCategory || '—'}</Detail>
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
