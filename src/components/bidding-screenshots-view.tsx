'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Pencil,
  Paperclip,
  AlertTriangle,
  Download,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { showToast } from '@/lib/web/toast-store';
import { exportCsv, datedName } from '@/lib/web/csv-export';
import { apiFetch } from '@/lib/web/api-client';
import { DetailDrawer } from '@/components/crud/detail-drawer';
import { PageHeader } from '@/components/page-header';
import { Badge, toneFromStatus } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BiddingFileRef, BiddingScreenshot } from '@/lib/domain/types';
import { useServerPaginatedList } from '@/hooks/use-server-paginated-list';
import { ListContainer } from '@/components/list-container';
import { ListToolbar } from '@/components/list-toolbar';
import { EmptyState } from '@/components/crud/empty-state';
import { Descriptions } from '@/components/crud/descriptions';
import { Can } from '@/components/crud/can';
import { BiddingDocumentPanel } from '@/components/bidding-document-panel';

interface BiddingFilters extends Record<string, string> {
  search: string;
  completionStatus: string;
  salesManager: string;
  overdue: string;
}

export function BiddingScreenshotsView() {
  const [detail, setDetail] = useState<BiddingScreenshot | null>(null);
  const [editing, setEditing] = useState<BiddingScreenshot | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const list = useServerPaginatedList<BiddingScreenshot, BiddingFilters>({
    endpoint: '/api/bidding-screenshots',
    pageSize: 20,
    initialFilters: { search: '', completionStatus: '', salesManager: '', overdue: '' },
    errorMessage: '加载招投标截图记录失败',
  });

  useEffect(() => {
    list.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!detail) return;
    const fresh = list.rows.find((r) => r.id === detail.id);
    if (fresh) setDetail(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.rows]);

  const salesOptions = useMemo(() => {
    const s = new Set<string>();
    list.rows.forEach((r) => r.salesManager && s.add(r.salesManager));
    return [...s].sort();
  }, [list.rows]);

  const completionOptions = useMemo(() => {
    const s = new Set<string>();
    list.rows.forEach((r) => r.completionStatus && s.add(r.completionStatus));
    return [...s].sort();
  }, [list.rows]);

  const reset = () => {
    list.setSearchInput('');
    list.setFilter('completionStatus', '');
    list.setFilter('salesManager', '');
    list.setFilter('overdue', '');
    list.setPage(1);
  };

  const handleExport = async () => {
    try {
      const all = await list.fetchAll();
      if (!all.length) {
        showToast('当前筛选结果为空', { kind: 'info' });
        return;
      }
      exportCsv(datedName('招投标截图'), [
        { header: '销售经理', get: (r) => r.salesManager },
        { header: '项目名称', get: (r) => r.projectName },
        { header: '项目所属学校', get: (r) => r.projectSchool },
        { header: '二级单位', get: (r) => r.projectSecondaryUnit },
        { header: '提交日期', get: (r) => r.submissionDate },
        { header: '需交付日期', get: (r) => r.dueDeliveryDate },
        { header: '预留天数', get: (r) => r.reservedDays },
        { header: '完成情况', get: (r) => r.completionStatus },
        { header: '类别', get: (r) => r.projectCategory.join('、') },
        { header: '项目经理', get: (r) => r.assignedProjectManager },
      ], all);
      showToast(`已导出 ${all.length} 条`, { kind: 'success' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败', { kind: 'error' });
    }
  };

  const retryAttachment = async (file: BiddingFileRef) => {
    if (!file.assetId) return;
    setRetrying(file.assetId);
    try {
      await apiFetch(`/api/files/${file.assetId}/retry`, { method: 'POST' });
      showToast('已触发重新转存', { kind: 'success' });
      list.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '重试失败', { kind: 'error' });
    } finally {
      setRetrying(null);
    }
  };

  const saveEdit = async (patch: Partial<BiddingScreenshot>) => {
    if (!editing) return;
    const updated = await apiFetch<BiddingScreenshot>(`/api/bidding-screenshots/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setEditing(null);
    setDetail(updated);
    list.refresh();
    showToast('已保存修改', { kind: 'success' });
  };

  return (
    <ListContainer>
      <PageHeader
        title="招投标截图"
        subtitle={`第三方推送数据，共 ${list.total} 条；本页只读，可由超管修正交付状态。`}
      />
      <ListToolbar
        search={{
          value: list.searchInput,
          onChange: list.setSearchInput,
          onSubmit: () => list.setPage(1),
          placeholder: '搜索项目名称、学校、销售',
        }}
        filters={
          <>
            <Select
              value={list.filters.completionStatus || '__all__'}
              onValueChange={(v) => list.setFilter('completionStatus', v === '__all__' ? '' : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-[140px] rounded-sm text-xs">
                <SelectValue placeholder="完成情况" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                {completionOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={list.filters.salesManager || '__all__'}
              onValueChange={(v) => list.setFilter('salesManager', v === '__all__' ? '' : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-[130px] rounded-sm text-xs">
                <SelectValue placeholder="销售经理" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部销售</SelectItem>
                {salesOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={list.filters.overdue || '__all__'}
              onValueChange={(v) => list.setFilter('overdue', v === '__all__' ? '' : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-[120px] rounded-sm text-xs">
                <SelectValue placeholder="逾期" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部</SelectItem>
                <SelectItem value="1">仅逾期</SelectItem>
                <SelectItem value="0">仅未逾期</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        onSubmit={() => list.setPage(1)}
        onReset={reset}
        onRefresh={list.refresh}
        refreshing={list.loading}
        onExport={handleExport}
        exportDisabled={list.total === 0}
        total={list.total}
      />

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-muted/60">
            <TableHead className="min-w-[240px]">项目</TableHead>
            <TableHead className="w-[160px]">销售 / 经理</TableHead>
            <TableHead className="w-[120px]">提交 / 交付</TableHead>
            <TableHead className="w-[100px]">预留天数</TableHead>
            <TableHead className="w-[120px]">完成情况</TableHead>
            <TableHead className="w-[110px]">文档进度</TableHead>
            <TableHead className="w-[100px] text-right">附件</TableHead>
            <TableHead className="w-[80px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.loading && list.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-16 text-center text-muted-foreground">加载中…</TableCell>
            </TableRow>
          )}
          {!list.loading && list.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                <EmptyState title="暂无招投标截图记录" description="等待第三方系统推送数据" />
              </TableCell>
            </TableRow>
          )}
          {list.rows.map((b) => {
            const overdue = b.dueDeliveryDate ? new Date(b.dueDeliveryDate).getTime() < Date.now() && !b.completionStatus : false;
            return (
              <TableRow key={b.id} className="cursor-pointer" onClick={() => setDetail(b)}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{b.projectName}</span>
                    {b.isCompanyParameter && (
                      <Badge tone="brand" className="shrink-0">公司参数</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {b.projectSchool}
                    {b.projectSecondaryUnit ? ` · ${b.projectSecondaryUnit}` : ''}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>{b.salesManager || '—'}</div>
                  <div className="mt-0.5">{b.assignedProjectManager || '—'}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>提交：{b.submissionDate || '—'}</div>
                  <div className={overdue ? 'text-status-danger' : ''}>
                    交付：{b.dueDeliveryDate || '—'}
                    {overdue && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                  </div>
                </TableCell>
                <TableCell className="text-xs">{b.reservedDays ?? '—'}</TableCell>
                <TableCell>
                  <Badge tone={toneFromStatus(b.completionStatus)}>
                    {b.completionStatus || '待处理'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DocumentProgressCell recordId={b.id} onOpenDetail={() => setDetail(b)} />
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Paperclip className="h-3 w-3" />
                    {b.attachments.length}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Can perm="bidding:edit">
                    <Button
                      size="xs"
                      variant="ghost"
                      className="h-7 rounded-sm px-2 text-brand"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(b);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                      编辑
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {list.totalPages > 1 && (
        <div className="border-t border-border p-3">
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </div>
      )}

      <BiddingDetailModal
        record={detail}
        onClose={() => setDetail(null)}
        onEdit={() => { if (detail) { setEditing(detail); setDetail(null); } }}
        onRetry={retryAttachment}
        retryingId={retrying}
      />
      {editing && (
        <BiddingEditDrawer
          record={editing}
          completionOptions={completionOptions}
          onClose={() => setEditing(null)}
          onSubmit={saveEdit}
        />
      )}
    </ListContainer>
  );
}

function BiddingDetailModal({
  record,
  onClose,
  onEdit,
  onRetry,
  retryingId,
}: {
  record: BiddingScreenshot | null;
  onClose: () => void;
  onEdit: () => void;
  onRetry: (f: BiddingFileRef) => void;
  retryingId: string | null;
}) {
  const rawJson = useMemo(() => {
    if (!record) return '';
    return JSON.stringify({ meta: record.rawMeta, payload: record.rawPayload }, null, 2);
  }, [record]);

  return (
    <DetailDrawer
      open={!!record}
      onClose={onClose}
      title={record?.projectName ?? '招投标截图详情'}
      description={record ? `${record.projectSchool} · 提交 ${record.submissionDate}` : undefined}
      width={760}
      footer={
        record ? (
          <div className="flex justify-end gap-2">
            <Can perm="bidding:edit">
              <Button size="sm" className="rounded-sm" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </Button>
            </Can>
          </div>
        ) : null
      }
    >
      {record && (
        <div className="space-y-4">
          <Descriptions
            column={3}
            items={[
              { label: '销售经理', children: record.salesManager || '—' },
              { label: '项目经理', children: record.assignedProjectManager || '—' },
              {
                label: '公司参数',
                children: record.isCompanyParameter ? '是' : '否',
              },
              { label: '项目所属学校', children: record.projectSchool },
              { label: '二级单位', children: record.projectSecondaryUnit || '—' },
              {
                label: '提交日期',
                children: record.submissionDate || '—',
              },
              {
                label: '需交付日期',
                children: record.dueDeliveryDate || '—',
              },
              { label: '预留天数', children: record.reservedDays != null ? `${record.reservedDays} 天` : '—' },
              { label: '外部编号', children: record.externalSerial || record.externalId || '—' },
              {
                label: '类别',
                children: record.projectCategory.length
                  ? record.projectCategory.map((c) => (
                      <Badge key={c} tone="info" className="mr-1">{c}</Badge>
                    ))
                  : '—',
              },
              { label: '完成情况', children: record.completionStatus || '—' },
              {
                label: '需求达成',
                children:
                  record.isMeetScreenshotRequirement === true
                    ? '是'
                    : record.isMeetScreenshotRequirement === false
                      ? '否'
                      : '—',
              },
            ]}
          />
          <Descriptions
            column={1}
            title="项目招标文件"
            items={[
              {
                label: '招标文件',
                children: (
                  <FileLink
                    file={record.projectBiddingFile}
                    onRetry={onRetry}
                    retrying={retryingId === record.projectBiddingFile?.assetId}
                  />
                ),
              },
            ]}
          />
          <BiddingDocumentPanel record={record} />
          <Descriptions
            column={1}
            title="截图需求说明"
            items={[
              {
                label: '详情',
                children: (
                  <pre className="whitespace-pre-wrap rounded-sm bg-muted/30 p-3 text-xs leading-relaxed">
                    {record.screenshotRequirement || '—'}
                  </pre>
                ),
              },
            ]}
          />
          <Descriptions
            column={1}
            title="交付信息"
            items={[
              { label: '交付文档', children: <FileLink file={record.deliveryDocument} onRetry={onRetry} retrying={retryingId === record.deliveryDocument?.assetId} /> },
              { label: '交付信息备注', children: record.deliveryRemark || '—' },
              { label: '销售反馈意见', children: record.salesFeedback || '—' },
            ]}
          />
          {record.attachments.length > 0 && (
            <Descriptions
              column={1}
              title={`交付附件（${record.attachments.length}）`}
              items={[
                {
                  label: '附件',
                  children: (
                    <div className="space-y-1.5">
                      {record.attachments.map((f, i) => (
                        <FileLink
                          key={f.assetId || f.objectId || i}
                          file={f}
                          onRetry={onRetry}
                          retrying={retryingId === f.assetId}
                        />
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          )}
          {(record.rectificationFeedback || record.rectifiedDocument) && (
            <Descriptions
              column={1}
              title="整改反馈"
              items={[
                { label: '整改说明', children: record.rectificationFeedback || '—' },
                {
                  label: '整改文档',
                  children: (
                    <FileLink
                      file={record.rectifiedDocument}
                      onRetry={onRetry}
                      retrying={retryingId === record.rectifiedDocument?.assetId}
                    />
                  ),
                },
              ]}
            />
          )}
          <details className="rounded-md border border-border bg-muted/20 p-3">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
              推送原始数据
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-sm bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
              {rawJson}
            </pre>
          </details>
        </div>
      )}
    </DetailDrawer>
  );
}

function DocumentProgressCell({
  recordId,
  onOpenDetail,
}: {
  recordId: string;
  onOpenDetail: () => void;
}) {
  const [p, setP] = useState<{
    total: number;
    matched: number;
    pending: number;
    task: number;
    version: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<{
      progress: Record<
        string,
        { total: number; matched: number; pending: number; task: number; version: number }
      >;
    }>(`/api/bidding-screenshots/progress?ids=${recordId}`)
      .then((res) => {
        if (cancelled) return;
        setP(res.progress[recordId] || null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  if (!p || p.total === 0) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetail();
        }}
        className="text-[11px] text-muted-foreground hover:text-brand"
      >
        未生成
      </button>
    );
  }
  const pct = Math.round((p.matched / p.total) * 100);
  const tone =
    p.pending === 0
      ? 'text-status-success'
      : p.task > 0
        ? 'text-brand'
        : 'text-status-warning';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenDetail();
      }}
      className="block w-full text-left"
    >
      <div className={`text-[11px] font-medium ${tone}`}>
        {p.matched}/{p.total} 已匹配
      </div>
      <div className="mt-0.5 h-1 w-[80px] overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${
            p.pending === 0 ? 'bg-status-success' : p.task > 0 ? 'bg-brand' : 'bg-status-warning'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {(p.pending > 0 || p.task > 0) && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          {p.pending > 0 && <span>待补充 {p.pending}</span>}
          {p.pending > 0 && p.task > 0 && <span> · </span>}
          {p.task > 0 && <span>督办 {p.task}</span>}
        </div>
      )}
    </button>
  );
}

function FileLink({
  file,
  onRetry,
  retrying,
}: {
  file: BiddingFileRef | null | undefined;
  onRetry: (f: BiddingFileRef) => void;
  retrying: boolean;
}) {
  if (!file) return <span className="text-muted-foreground">—</span>;
  const href = file.assetId ? `/api/files/preview/${file.assetId}` : file.url || '#';
  return (
    <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-background px-2 py-1.5">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 truncate text-xs text-brand hover:underline"
      >
        <Paperclip className="h-3 w-3 shrink-0" />
        <span className="truncate">{file.name || '附件'}</span>
        {file.size ? <span className="shrink-0 text-muted-foreground">({file.size})</span> : null}
      </a>
      {file.assetId && file.storageStatus === 'failed' && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-60"
          onClick={() => onRetry(file)}
          disabled={retrying}
        >
          <RefreshCw className={retrying ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
          重试
        </button>
      )}
    </div>
  );
}

function BiddingEditDrawer({
  record,
  completionOptions,
  onClose,
  onSubmit,
}: {
  record: BiddingScreenshot;
  completionOptions: string[];
  onClose: () => void;
  onSubmit: (patch: Partial<BiddingScreenshot>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<BiddingScreenshot>>({
    completionStatus: record.completionStatus,
    deliveryRemark: record.deliveryRemark,
    isMeetScreenshotRequirement: record.isMeetScreenshotRequirement,
    salesFeedback: record.salesFeedback,
    rectificationFeedback: record.rectificationFeedback,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onSubmit(draft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[560px] flex-col bg-card shadow-dropdown animate-slide-in-right">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">编辑招投标截图</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{record.projectName}</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="完成情况">
              <Select
                value={draft.completionStatus ?? ''}
                onValueChange={(v) => setDraft({ ...draft, completionStatus: v || null })}
              >
                <SelectTrigger className="h-8 rounded-sm"><SelectValue placeholder="请选择" /></SelectTrigger>
                <SelectContent>
                  {completionOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="需求达成">
              <Select
                value={
                  draft.isMeetScreenshotRequirement === true ? '1'
                    : draft.isMeetScreenshotRequirement === false ? '0' : ''
                }
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    isMeetScreenshotRequirement: v === '1' ? true : v === '0' ? false : null,
                  })
                }
              >
                <SelectTrigger className="h-8 rounded-sm"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">是</SelectItem>
                  <SelectItem value="0">否</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="交付备注">
            <Textarea
              rows={3}
              className="rounded-sm text-sm"
              value={draft.deliveryRemark ?? ''}
              onChange={(e) => setDraft({ ...draft, deliveryRemark: e.target.value })}
            />
          </Field>
          <Field label="销售反馈">
            <Textarea
              rows={3}
              className="rounded-sm text-sm"
              value={draft.salesFeedback ?? ''}
              onChange={(e) => setDraft({ ...draft, salesFeedback: e.target.value })}
            />
          </Field>
          <Field label="整改反馈">
            <Textarea
              rows={3}
              className="rounded-sm text-sm"
              value={draft.rectificationFeedback ?? ''}
              onChange={(e) => setDraft({ ...draft, rectificationFeedback: e.target.value })}
            />
          </Field>
          {err && (
            <div className="rounded-sm border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
              {err}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" className="rounded-sm" onClick={onClose} disabled={saving}>取消</Button>
          <Button size="sm" className="rounded-sm" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存修改'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

void Download;
