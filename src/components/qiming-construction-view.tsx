'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  Calendar,
  Building2,
  User,
  GraduationCap,
  Star,
  RefreshCw,
  Download,
} from 'lucide-react';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { showToast } from '@/lib/web/toast-store';
import { apiFetch } from '@/lib/web/api-client';
import { exportCsv, datedName } from '@/lib/web/csv-export';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/modal';
import { AttachmentList } from '@/components/attachment-viewer';
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
import type { QimingConstruction } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

interface ListResponse {
  rows: QimingConstruction[];
  total: number;
}

const PAGE_SIZE = 20;

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
  const [page, setPage] = useState(1);
  const [focusId, setFocusId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    apiFetch<ListResponse>('/api/qiming-construction?limit=200')
      .then((res) => {
        setRows(res.rows);
        setDetail((d) => (d ? (res.rows.find((r) => r.id === d.id) ?? d) : d));
      })
      .catch((err: unknown) => showToast(err instanceof Error ? err.message : '加载启明星建设失败', { kind: 'error' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    setNowTs(Date.now());
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
      return [r.school, r.college, r.projectName, r.salesManager, r.projectManager, r.buildMajor, r.schoolLevel]
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

  const overdue = (r: QimingConstruction): boolean => {
    if (!r.projectDeliveryTime || !nowTs) return false;
    return new Date(r.projectDeliveryTime).getTime() < nowTs;
  };

  const handleExport = () => {
    if (filtered.length === 0) {
      showToast('当前筛选结果为空，无法导出', { kind: 'info' });
      return;
    }
    exportCsv(datedName('启明星建设'), [
      { header: '年度', get: (r) => r.projectYear },
      { header: '项目名称', get: (r) => r.projectName },
      { header: '学校', get: (r) => r.school },
      { header: '学院', get: (r) => r.college },
      { header: '学校层级', get: (r) => r.schoolLevel },
      { header: '建设专业', get: (r) => r.buildMajor },
      { header: '是否签合同', get: (r) =>
        r.isSignContract === null ? '' : r.isSignContract ? '是' : '否' },
      { header: '销售经理', get: (r) => r.salesManager },
      { header: '项目经理', get: (r) => r.projectManager },
      { header: '交付时间', get: (r) => (r.projectDeliveryTime ? r.projectDeliveryTime.slice(0, 10) : '') },
      { header: '项目情况反馈', get: (r) => r.projectStatusFeedback },
      { header: '建设内容', get: (r) => r.buildContentText },
      { header: '特殊说明', get: (r) => r.buildSpecialDescText },
      { header: '资料数', get: (r) => r.projectMaterials.length },
    ], filtered);
    showToast(`已导出 ${filtered.length} 条启明星建设记录`, { kind: 'success' });
  };

  return (
    <LlmLoadingMask loading={loading} label="加载启明星建设…" className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">
        <PageHeader
          icon={Star}
          title="启明星建设"
          subtitle="超星推送的启明星建设项目工单，仅供查看与跟进。"
          breadcrumb={[{ label: '工作台' }, { label: '启明星建设' }]}
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
                placeholder="搜索学校/学院/项目/销售/负责人"
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
                  <th className="px-3 py-2 text-left font-medium">项目名称</th>
                  <th className="px-3 py-2 text-left font-medium">学校 / 学院</th>
                  <th className="px-3 py-2 text-left font-medium">建设专业</th>
                  <th className="px-3 py-2 text-left font-medium">销售 / 项目经理</th>
                  <th className="px-3 py-2 text-left font-medium">交付时间</th>
                  <th className="px-3 py-2 text-left font-medium">合同</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => {
                  const isOverdue = overdue(r);
                  const isFocus = focusId === r.id;
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
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.projectName ?? '—'}</div>
                        {r.schoolLevel ? (
                          <div className="mt-0.5 text-xs text-muted-foreground">{r.schoolLevel}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {r.school ?? '—'}
                        </div>
                        {r.college ? (
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <GraduationCap className="h-3 w-3" />
                            {r.college}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{r.buildMajor ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        <div>{r.salesManager ?? '—'}</div>
                        {r.projectManager ? (
                          <div className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                            <User className="h-3 w-3" />
                            {r.projectManager}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {r.projectDeliveryTime ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 font-mono text-xs',
                              isOverdue && 'text-status-danger',
                            )}
                          >
                            <Calendar className="h-3 w-3" />
                            {formatDateTime(r.projectDeliveryTime)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.isSignContract === null ? (
                          '—'
                        ) : r.isSignContract ? (
                          <Badge tone="success">已签</Badge>
                        ) : (
                          <Badge tone="neutral">未签</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {paged.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                      暂无启明星建设记录
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
          title={detail?.projectName ?? '启明星建设详情'}
          description={
            detail
              ? `年度 ${detail.projectYear ?? '—'} · 销售 ${detail.salesManager ?? '—'} · 项目经理 ${detail.projectManager ?? '—'}`
              : undefined
          }
          size="xl"
        >
          {detail && (
            <div className="space-y-3 text-sm">
              <Detail label="学校">
                {detail.school ?? '—'}
                {detail.schoolLevel ? `（${detail.schoolLevel}）` : ''}
              </Detail>
              <Detail label="学院">{detail.college ?? '—'}</Detail>
              <Detail label="建设专业">{detail.buildMajor ?? '—'}</Detail>
              <Detail label="项目交付时间">
                <span className="font-mono text-xs">{formatDateTime(detail.projectDeliveryTime)}</span>
              </Detail>
              <Detail label="是否签合同">
                {detail.isSignContract === null ? (
                  '—'
                ) : detail.isSignContract ? (
                  <Badge tone="success">已签</Badge>
                ) : (
                  <Badge tone="neutral">未签</Badge>
                )}
              </Detail>
              {detail.buildContentHtml ? (
                <Detail label="建设内容">
                  <div
                    className="prose prose-sm max-w-none rounded border border-border bg-muted/20 p-3"
                    dangerouslySetInnerHTML={{ __html: detail.buildContentHtml }}
                  />
                </Detail>
              ) : detail.buildContentText ? (
                <Detail label="建设内容">
                  <div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">
                    {detail.buildContentText}
                  </div>
                </Detail>
              ) : null}
              {detail.buildSpecialDescHtml ? (
                <Detail label="特殊说明及材料">
                  <div
                    className="prose prose-sm max-w-none rounded border border-border bg-muted/20 p-3"
                    dangerouslySetInnerHTML={{ __html: detail.buildSpecialDescHtml }}
                  />
                </Detail>
              ) : detail.buildSpecialDescText ? (
                <Detail label="特殊说明及材料">
                  <div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">
                    {detail.buildSpecialDescText}
                  </div>
                </Detail>
              ) : null}
              {detail.projectMaterials.length ? (
                <Detail label="项目相关资料">
                  <AttachmentList files={detail.projectMaterials} business="qiming" externalId={detail.id} field="projectMaterials" onRetried={refresh} />
                </Detail>
              ) : null}
              {detail.projectStatusFeedback ? (
                <Detail label="项目情况反馈">
                  <div className="whitespace-pre-wrap rounded border border-border bg-muted/20 p-3 text-sm">
                    {detail.projectStatusFeedback}
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
