'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Paperclip, Search, Calendar, Building2, User } from 'lucide-react';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { showToast } from '@/lib/web/toast-store';
import { apiFetch } from '@/lib/web/api-client';
import type { ProjectDemand } from '@/lib/domain/types';

interface ListResponse {
  rows: ProjectDemand[];
  total: number;
}

function storageBadge(file: { storageStatus?: string | null }) {
  switch (file.storageStatus) {
    case 'pending':
      return { label: '待转存', className: 'bg-zinc-500/10 text-zinc-500' };
    case 'fetching':
      return { label: '转存中', className: 'bg-brand/10 text-brand' };
    case 'failed':
      return { label: '转存失败', className: 'bg-red-500/10 text-red-500' };
    default:
      return null;
  }
}

function FileItem({ file }: { file: ProjectDemand['providedMaterials'][number] }) {
  const href = file.assetId ? `/api/files/demand-attachments/${file.assetId}` : file.url;
  const badge = storageBadge(file);
  const downloadable = !!href && file.storageStatus !== 'failed';
  const inner = (
    <>
      <Paperclip className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{file.name || '附件'}</span>
      {badge ? <span className={`ml-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge.className}`}>{badge.label}</span> : null}
    </>
  );
  return downloadable ? (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-sm text-brand hover:underline">
      {inner}
    </a>
  ) : (
    <span className="inline-flex max-w-full items-center gap-1 text-sm text-muted-foreground" title={file.storageError ?? undefined}>
      {inner}
    </span>
  );
}

export function ProjectDemandsView() {
  const [rows, setRows] = useState<ProjectDemand[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ProjectDemand | null>(null);
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');

  const refresh = useCallback(() => {
    setLoading(true);
    apiFetch<ListResponse>('/api/project-demands?limit=200')
      .then((res) => setRows(res.rows))
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : '加载项目建设申请失败', { kind: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.deletedAt) return false;
      if (year && r.projectYear !== year) return false;
      if (!k) return true;
      return [r.company, r.salesManager, r.projectManager, r.demandType, r.product, r.industryCategory]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(k));
    });
  }, [rows, q, year]);

  const yearOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.projectYear).filter((v): v is string => !!v))).sort().reverse(),
    [rows],
  );

  const overdue = (r: ProjectDemand): boolean => {
    if (!r.requiredFinishDate) return false;
    if (r.completionStatus === '已完成' || r.completionStatus === '已交付') return false;
    return r.requiredFinishDate < new Date().toISOString().slice(0, 10);
  };

  return (
    <LlmLoadingMask loading={loading} label="加载项目建设申请…" className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">项目建设申请</h1>
            <p className="mt-1 text-sm text-muted-foreground">超星推送的项目建设需求工单，仅供查看与跟进。</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索单位/销售/负责人/需求类型/产品"
                className="h-8 w-72 rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">全部年度</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">年度</th>
                <th className="px-3 py-2 text-left font-medium">销售经理</th>
                <th className="px-3 py-2 text-left font-medium">所属单位</th>
                <th className="px-3 py-2 text-left font-medium">需求类型 / 产品</th>
                <th className="px-3 py-2 text-left font-medium">要求完成</th>
                <th className="px-3 py-2 text-left font-medium">项目负责人</th>
                <th className="px-3 py-2 text-left font-medium">完成情况</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setDetail(r)}
                  className="cursor-pointer border-t border-border hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.projectYear ?? '—'}</td>
                  <td className="px-3 py-2">{r.salesManager ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {r.company}
                    </div>
                    {r.industryCategory ? <div className="mt-0.5 text-xs text-muted-foreground">{r.industryCategory}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.demandType ?? '—'}</div>
                    {r.product ? <div className="mt-0.5 text-xs text-muted-foreground">{r.product}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.requiredFinishDate ? (
                      <span className={`inline-flex items-center gap-1 font-mono text-xs ${overdue(r) ? 'text-red-500' : ''}`}>
                        <Calendar className="h-3 w-3" />{r.requiredFinishDate}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.projectManager ? (
                      <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5 text-muted-foreground" />{r.projectManager}</span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.completionStatus ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.completionStatus}</span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">暂无项目建设申请</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {detail ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setDetail(null)}
          >
            <div
              className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="border-b border-border p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">项目建设申请 · {detail.externalId}</div>
                <h2 className="mt-1 text-lg font-semibold">{detail.company}</h2>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>年度 {detail.projectYear ?? '—'}</span>
                  <span>销售 {detail.salesManager ?? '—'}</span>
                  <span>负责人 {detail.projectManager ?? '—'}</span>
                </div>
              </div>
              <div className="space-y-3 p-4 text-sm">
                <Detail label="需求类型">{detail.demandType ?? '—'}</Detail>
                <Detail label="所属产品">{detail.product ?? '—'}</Detail>
                <Detail label="行业类别">{detail.industryCategory ?? '—'}</Detail>
                {detail.requiredFinishDate ? (
                  <Detail label="要求完成时间"><span className="font-mono text-xs">{detail.requiredFinishDate}</span></Detail>
                ) : null}
                {detail.estimatedFinishDate ? (
                  <Detail label="预计完成时间"><span className="font-mono text-xs">{detail.estimatedFinishDate}</span></Detail>
                ) : null}
                <Detail label="完成情况">{detail.completionStatus ?? '—'}</Detail>
                {detail.demandDescHtml ? (
                  <Detail label="具体事宜及需求说明">
                    <div className="prose prose-sm max-w-none rounded border border-border bg-muted/20 p-3" dangerouslySetInnerHTML={{ __html: detail.demandDescHtml }} />
                  </Detail>
                ) : detail.demandDescText ? (
                  <Detail label="具体事宜及需求说明"><div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">{detail.demandDescText}</div></Detail>
                ) : null}
                {detail.providedMaterials.length ? (
                  <Detail label="所提供材料">
                    <div className="flex flex-col gap-1">
                      {detail.providedMaterials.map((f, i) => (
                        <FileItem key={f.objectId ?? f.url ?? i} file={f} />
                      ))}
                    </div>
                  </Detail>
                ) : null}
                <Detail label="交付内容">{detail.deliveryContent ?? '—'}{detail.otherDeliveryContent ? `（其他：${detail.otherDeliveryContent}）` : ''}</Detail>
                {detail.deliveryDocType.length ? (
                  <Detail label="交付文档类型">
                    <div className="flex flex-wrap gap-1">
                      {detail.deliveryDocType.map((t) => (
                        <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>
                      ))}
                    </div>
                  </Detail>
                ) : null}
                {detail.deliveryDocs.length ? (
                  <Detail label="交付文档">
                    <div className="flex flex-col gap-1">
                      {detail.deliveryDocs.map((f, i) => (
                        <FileItem key={f.objectId ?? f.url ?? i} file={f} />
                      ))}
                    </div>
                  </Detail>
                ) : null}
                {detail.deliveryRemark ? (
                  <Detail label="交付信息备注">
                    <div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">{detail.deliveryRemark}</div>
                  </Detail>
                ) : null}
              </div>
              <div className="flex justify-end gap-2 border-t border-border p-3">
                <button
                  onClick={() => setDetail(null)}
                  className="h-8 rounded-md border border-border bg-background px-3 text-sm hover:bg-muted"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </LlmLoadingMask>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{children}</div>
    </div>
  );
}
