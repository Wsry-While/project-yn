'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Search, Calendar, Building2, User, RefreshCw, Download } from 'lucide-react';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { showToast } from '@/lib/web/toast-store';
import { apiFetch } from '@/lib/web/api-client';
import { exportCsv, datedName } from '@/lib/web/csv-export';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/modal';
import { AttachmentList } from '@/components/attachment-viewer';
import { PageHeader } from '@/components/page-header';
import { Badge, toneFromStatus } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ProjectDemand } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

interface ListResponse {
  rows: ProjectDemand[];
  total: number;
}

const PAGE_SIZE = 20;

export function ProjectDemandsView() {
  const [rows, setRows] = useState<ProjectDemand[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ProjectDemand | null>(null);
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [page, setPage] = useState(1);
  const [focusId, setFocusId] = useState<string | null>(null);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focus');
    if (focus) setFocusId(focus);
  }, []);

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

  const overdue = (r: ProjectDemand): boolean => {
    if (!r.requiredFinishDate) return false;
    if (r.completionStatus === '已完成' || r.completionStatus === '已交付') return false;
    return r.requiredFinishDate < new Date().toISOString().slice(0, 10);
  };

  const handleExport = () => {
    if (filtered.length === 0) {
      showToast('当前筛选结果为空，无法导出', { kind: 'info' });
      return;
    }
    exportCsv(datedName('项目建设申请'), [
      { header: '年度', get: (r) => r.projectYear },
      { header: '所属单位', get: (r) => r.company },
      { header: '行业类别', get: (r) => r.industryCategory },
      { header: '需求类型', get: (r) => r.demandType },
      { header: '所属产品', get: (r) => r.product.join('、') },
      { header: '销售经理', get: (r) => r.salesManager },
      { header: '项目负责人', get: (r) => r.projectManager },
      { header: '要求完成时间', get: (r) => r.requiredFinishDate },
      { header: '完成情况', get: (r) => r.completionStatus },
      { header: '预计完成时间', get: (r) => r.estimatedFinishDate },
      { header: '交付内容', get: (r) => r.deliveryContent },
      { header: '交付内容（其他）', get: (r) => r.otherDeliveryContent },
      { header: '交付文档类型', get: (r) => r.deliveryDocType.join('、') },
      { header: '交付备注', get: (r) => r.deliveryRemark },
      { header: '需求说明', get: (r) => r.demandDescText },
      { header: '材料数', get: (r) => r.providedMaterials.length },
      { header: '交付文档数', get: (r) => r.deliveryDocs.length },
    ], filtered);
    showToast(`已导出 ${filtered.length} 条建设申请`, { kind: 'success' });
  };

  return (
    <LlmLoadingMask loading={loading} label="加载项目建设申请…" className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">
        <PageHeader
          icon={FileText}
          title="项目建设申请"
          subtitle="超星推送的项目建设需求工单，仅供查看与跟进。"
          breadcrumb={[{ label: '工作台' }, { label: '项目建设申请' }]}
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
            <div className="relative h-8 min-w-[260px] flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索单位/销售/负责人/需求类型/产品"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <Select
              value={year || '__all__'}
              onValueChange={(v) => {
                setYear(v === '__all__' ? '' : v);
                setPage(1);
              }}
            >
              <SelectTrigger size="sm" className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="年度" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部年度</SelectItem>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              导出 CSV
            </button>
            <div className="ml-auto font-mono text-[11px] text-muted-foreground">
              筛选结果 <span className="text-foreground">{total}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
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
                {paged.map((r) => {
                  const isFocus = focusId === r.id;
                  const isOverdue = overdue(r);
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setDetail(r)}
                      className={cn(
                        'cursor-pointer border-t border-border transition hover:bg-muted/30',
                        isFocus && 'bg-brand/5',
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{r.projectYear ?? '—'}</td>
                      <td className="px-3 py-2">{r.salesManager ?? '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {r.company}
                        </div>
                        {r.industryCategory ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">{r.industryCategory}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div>{r.demandType ?? '—'}</div>
                        {r.product ? <div className="mt-0.5 text-xs text-muted-foreground">{r.product}</div> : null}
                      </td>
                      <td className="px-3 py-2">
                        {r.requiredFinishDate ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 font-mono text-xs',
                              isOverdue && 'text-status-danger',
                            )}
                          >
                            <Calendar className="h-3 w-3" />
                            {r.requiredFinishDate}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.projectManager ? (
                          <span className="inline-flex items-center gap-1">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                            {r.projectManager}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.completionStatus ? (
                          <Badge tone={toneFromStatus(r.completionStatus)}>{r.completionStatus}</Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      暂无项目建设申请
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {total > PAGE_SIZE && (
            <Pagination page={safePage} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          )}
        </div>

        <Modal
          open={!!detail}
          onClose={() => setDetail(null)}
          title={detail?.company ?? '项目建设申请详情'}
          description={
            detail
              ? `年度 ${detail.projectYear ?? '—'} · 销售 ${detail.salesManager ?? '—'} · 负责人 ${detail.projectManager ?? '—'}`
              : undefined
          }
          size="xl"
        >
          {detail && (
            <div className="space-y-3 text-sm">
              <Detail label="需求类型">{detail.demandType ?? '—'}</Detail>
              <Detail label="所属产品">{detail.product ?? '—'}</Detail>
              <Detail label="行业类别">{detail.industryCategory ?? '—'}</Detail>
              {detail.requiredFinishDate ? (
                <Detail label="要求完成时间">
                  <span className="font-mono text-xs">{detail.requiredFinishDate}</span>
                </Detail>
              ) : null}
              {detail.estimatedFinishDate ? (
                <Detail label="预计完成时间">
                  <span className="font-mono text-xs">{detail.estimatedFinishDate}</span>
                </Detail>
              ) : null}
              <Detail label="完成情况">
                {detail.completionStatus ? (
                  <Badge tone={toneFromStatus(detail.completionStatus)}>{detail.completionStatus}</Badge>
                ) : (
                  '—'
                )}
              </Detail>
              {detail.demandDescHtml ? (
                <Detail label="具体事宜及需求说明">
                  <div
                    className="prose prose-sm max-w-none rounded border border-border bg-muted/20 p-3"
                    dangerouslySetInnerHTML={{ __html: detail.demandDescHtml }}
                  />
                </Detail>
              ) : detail.demandDescText ? (
                <Detail label="具体事宜及需求说明">
                  <div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">
                    {detail.demandDescText}
                  </div>
                </Detail>
              ) : null}
              {detail.providedMaterials.length ? (
                <Detail label="所提供材料">
                  <AttachmentList files={detail.providedMaterials} externalId={detail.id} field="providedMaterials" onRetried={refresh} />
                </Detail>
              ) : null}
              <Detail label="交付内容">
                {detail.deliveryContent ?? '—'}
                {detail.otherDeliveryContent ? `（其他：${detail.otherDeliveryContent}）` : ''}
              </Detail>
              {detail.deliveryDocType.length ? (
                <Detail label="交付文档类型">
                  <div className="flex flex-wrap gap-1">
                    {detail.deliveryDocType.map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {t}
                      </span>
                    ))}
                  </div>
                </Detail>
              ) : null}
              {detail.deliveryDocs.length ? (
                <Detail label="交付文档">
                  <AttachmentList files={detail.deliveryDocs} externalId={detail.id} field="deliveryDocs" onRetried={refresh} />
                </Detail>
              ) : null}
              {detail.deliveryRemark ? (
                <Detail label="交付信息备注">
                  <div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">
                    {detail.deliveryRemark}
                  </div>
                </Detail>
              ) : null}
            </div>
          )}
        </Modal>
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
