'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Paperclip, Search, Calendar, Building2, User, GraduationCap, Star } from 'lucide-react';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { showToast } from '@/lib/web/toast-store';
import { apiFetch } from '@/lib/web/api-client';
import type { QimingConstruction } from '@/lib/domain/types';

interface ListResponse {
  rows: QimingConstruction[];
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

function FileItem({ file }: { file: QimingConstruction['projectMaterials'][number] }) {
  const href = file.assetId ? `/api/files/qiming-attachments/${file.assetId}` : file.url;
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

function formatDateTime(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function QimingConstructionView() {
  const [rows, setRows] = useState<QimingConstruction[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<QimingConstruction | null>(null);
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [nowTs, setNowTs] = useState<number>(0);

  const refresh = useCallback(() => {
    setLoading(true);
    apiFetch<ListResponse>('/api/qiming-construction?limit=200')
      .then((res) => setRows(res.rows))
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : '加载启明星建设失败', { kind: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    setNowTs(Date.now());
  }, [refresh]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.deletedAt) return false;
      if (year && r.projectYear !== year) return false;
      if (!k) return true;
      return [r.school, r.college, r.projectName, r.salesManager, r.projectManager, r.buildMajor, r.schoolLevel]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(k));
    });
  }, [rows, q, year]);

  const yearOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.projectYear).filter((v): v is string => !!v))).sort().reverse(),
    [rows],
  );

  const overdue = (r: QimingConstruction): boolean => {
    if (!r.projectDeliveryTime || !nowTs) return false;
    return new Date(r.projectDeliveryTime).getTime() < nowTs;
  };

  return (
    <LlmLoadingMask loading={loading} label="加载启明星建设…" className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <Star className="h-5 w-5 text-brand" />
              启明星建设
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">超星推送的启明星建设项目工单，仅供查看与跟进。</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索学校/学院/项目/销售/负责人"
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
                <th className="px-3 py-2 text-left font-medium">项目名称</th>
                <th className="px-3 py-2 text-left font-medium">学校 / 学院</th>
                <th className="px-3 py-2 text-left font-medium">建设专业</th>
                <th className="px-3 py-2 text-left font-medium">销售 / 项目经理</th>
                <th className="px-3 py-2 text-left font-medium">交付时间</th>
                <th className="px-3 py-2 text-left font-medium">合同</th>
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
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.projectName ?? '—'}</div>
                    {r.schoolLevel ? <div className="mt-0.5 text-xs text-muted-foreground">{r.schoolLevel}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                      {r.school ?? '—'}
                    </div>
                    {r.college ? <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><GraduationCap className="h-3 w-3" />{r.college}</div> : null}
                  </td>
                  <td className="px-3 py-2">{r.buildMajor ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    <div>{r.salesManager ?? '—'}</div>
                    {r.projectManager ? <div className="mt-0.5 flex items-center gap-1 text-muted-foreground"><User className="h-3 w-3" />{r.projectManager}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    {r.projectDeliveryTime ? (
                      <span className={`inline-flex items-center gap-1 font-mono text-xs ${overdue(r) ? 'text-red-500' : ''}`}>
                        <Calendar className="h-3 w-3" />{formatDateTime(r.projectDeliveryTime)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.isSignContract === null ? '—' : r.isSignContract ? (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-600">已签</span>
                    ) : (
                      <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-xs text-zinc-500">未签</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">暂无启明星建设记录</td></tr>
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
                <div className="text-xs uppercase tracking-wide text-muted-foreground">启明星建设 · {detail.externalId}</div>
                <h2 className="mt-1 text-lg font-semibold">{detail.projectName ?? '未命名项目'}</h2>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>年度 {detail.projectYear ?? '—'}</span>
                  <span>销售 {detail.salesManager ?? '—'}</span>
                  <span>项目经理 {detail.projectManager ?? '—'}</span>
                  <span>合同 {detail.isSignContract === null ? '—' : detail.isSignContract ? '已签' : '未签'}</span>
                </div>
              </div>
              <div className="space-y-3 p-4 text-sm">
                <Detail label="学校">{detail.school ?? '—'}{detail.schoolLevel ? `（${detail.schoolLevel}）` : ''}</Detail>
                <Detail label="学院">{detail.college ?? '—'}</Detail>
                <Detail label="建设专业">{detail.buildMajor ?? '—'}</Detail>
                <Detail label="项目交付时间">
                  <span className="font-mono text-xs">{formatDateTime(detail.projectDeliveryTime)}</span>
                </Detail>
                {detail.buildContentHtml ? (
                  <Detail label="建设内容">
                    <div className="prose prose-sm max-w-none rounded border border-border bg-muted/20 p-3" dangerouslySetInnerHTML={{ __html: detail.buildContentHtml }} />
                  </Detail>
                ) : detail.buildContentText ? (
                  <Detail label="建设内容">
                    <div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">{detail.buildContentText}</div>
                  </Detail>
                ) : null}
                {detail.buildSpecialDescHtml ? (
                  <Detail label="特殊说明及材料">
                    <div className="prose prose-sm max-w-none rounded border border-border bg-muted/20 p-3" dangerouslySetInnerHTML={{ __html: detail.buildSpecialDescHtml }} />
                  </Detail>
                ) : detail.buildSpecialDescText ? (
                  <Detail label="特殊说明及材料">
                    <div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">{detail.buildSpecialDescText}</div>
                  </Detail>
                ) : null}
                {detail.projectMaterials.length ? (
                  <Detail label="项目相关资料">
                    <div className="flex flex-col gap-1">
                      {detail.projectMaterials.map((f, i) => (
                        <FileItem key={f.objectId ?? f.url ?? i} file={f} />
                      ))}
                    </div>
                  </Detail>
                ) : null}
                {detail.projectStatusFeedback ? (
                  <Detail label="项目情况反馈">
                    <div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">{detail.projectStatusFeedback}</div>
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
