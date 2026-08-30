'use client';
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Paperclip, ExternalLink } from 'lucide-react';
import { showToast } from '@/lib/web/toast-store';
import { exportCsv, datedName } from '@/lib/web/csv-export';
import { apiFetch } from '@/lib/web/api-client';
import { DetailDrawer } from '@/components/crud/detail-drawer';
import { AttachmentList } from '@/components/attachment-viewer';
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
import type { ProjectDemand } from '@/lib/domain/types';
import { useServerPaginatedList } from '@/hooks/use-server-paginated-list';
import { ListContainer } from '@/components/list-container';
import { ListToolbar } from '@/components/list-toolbar';
import { EmptyState } from '@/components/crud/empty-state';
import { Descriptions } from '@/components/crud/descriptions';
import { Can } from '@/components/crud/can';

interface DemandFilters extends Record<string, string> {
  search: string;
  year: string;
  salesManager: string;
  completionStatus: string;
}

export function ProjectDemandsView() {
  const [detail, setDetail] = useState<ProjectDemand | null>(null);
  const [editing, setEditing] = useState<ProjectDemand | null>(null);

  const list = useServerPaginatedList<ProjectDemand, DemandFilters>({
    endpoint: '/api/project-demands',
    pageSize: 20,
    initialFilters: { search: '', year: '', salesManager: '', completionStatus: '' },
    errorMessage: '加载项目建设申请失败',
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

  const years = useMemo(() => {
    const s = new Set<string>();
    list.rows.forEach((r) => r.projectYear && s.add(r.projectYear));
    return [...s].sort().reverse();
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
    list.setFilter('year', '');
    list.setFilter('salesManager', '');
    list.setFilter('completionStatus', '');
    list.setPage(1);
  };

  const handleExport = async () => {
    try {
      const all = await list.fetchAll();
      if (!all.length) {
        showToast('当前筛选结果为空', { kind: 'info' });
        return;
      }
      exportCsv(datedName('项目建设申请'), [
        { header: '年度', get: (r) => r.projectYear },
        { header: '学校', get: (r) => r.company },
        { header: '行业', get: (r) => r.industryCategory },
        { header: '需求类型', get: (r) => r.demandType },
        { header: '产品', get: (r) => r.product.join('、') },
        { header: '销售经理', get: (r) => r.salesManager },
        { header: '项目经理', get: (r) => r.projectManager },
        { header: '要求完成时间', get: (r) => r.requiredFinishDate },
        { header: '完成情况', get: (r) => r.completionStatus },
        { header: '预计完成', get: (r) => r.estimatedFinishDate },
        { header: '交付内容', get: (r) => r.deliveryContent },
      ], all);
      showToast(`已导出 ${all.length} 条`, { kind: 'success' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败', { kind: 'error' });
    }
  };

  const saveEdit = async (patch: Partial<ProjectDemand>) => {
    if (!editing) return;
    const updated = await apiFetch<ProjectDemand>(`/api/project-demands/${editing.id}`, {
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
        title="项目建设申请"
        subtitle={`超星表单推送，共 ${list.total} 条；本页只读，可由超管修正交付状态。`}
      />
      <ListToolbar
        search={{
          value: list.searchInput,
          onChange: list.setSearchInput,
          onSubmit: () => list.setPage(1),
          placeholder: '搜索学校、需求、销售',
        }}
        filters={
          <>
            <Select
              value={list.filters.year || '__all__'}
              onValueChange={(v) => list.setFilter('year', v === '__all__' ? '' : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-[110px] rounded-sm text-xs">
                <SelectValue placeholder="年度" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部年度</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
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
              value={list.filters.completionStatus || '__all__'}
              onValueChange={(v) => list.setFilter('completionStatus', v === '__all__' ? '' : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-[130px] rounded-sm text-xs">
                <SelectValue placeholder="完成情况" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部状态</SelectItem>
                {completionOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
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
            <TableHead className="min-w-[260px]">单位 / 需求</TableHead>
            <TableHead className="w-[120px]">年度 / 类型</TableHead>
            <TableHead className="w-[160px]">销售 / 项目经理</TableHead>
            <TableHead className="w-[120px]">要求完成</TableHead>
            <TableHead className="w-[120px]">完成情况</TableHead>
            <TableHead className="w-[100px] text-right">附件</TableHead>
            <TableHead className="w-[80px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.loading && list.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-16 text-center text-muted-foreground">加载中…</TableCell>
            </TableRow>
          )}
          {!list.loading && list.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <EmptyState title="暂无项目建设申请" description="等待超星表单推送数据" />
              </TableCell>
            </TableRow>
          )}
          {list.rows.map((d) => (
            <TableRow key={d.id} className="cursor-pointer" onClick={() => setDetail(d)}>
              <TableCell>
                <div className="truncate text-sm font-medium">{d.company || '—'}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {d.demandDescText || d.demandType || '—'}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <div>{d.projectYear || '—'}</div>
                <div className="mt-0.5">{d.demandType || '—'}</div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <div>{d.salesManager || '—'}</div>
                <div className="mt-0.5">{d.projectManager || '—'}</div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {d.requiredFinishDate?.slice(0, 10) || '—'}
              </TableCell>
              <TableCell>
                <Badge tone={toneFromStatus(d.completionStatus)}>
                  {d.completionStatus || '待处理'}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  {d.providedMaterials.length + d.deliveryDocs.length}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Can perm="demand:edit">
                  <Button
                    size="xs"
                    variant="ghost"
                    className="h-7 rounded-sm px-2 text-brand"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(d);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                    编辑
                  </Button>
                </Can>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {list.totalPages > 1 && (
        <div className="border-t border-border p-3">
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </div>
      )}

      <DemandDetailModal
        record={detail}
        onClose={() => setDetail(null)}
        onEdit={() => { if (detail) { setEditing(detail); setDetail(null); } }}
        onTransferred={list.refresh}
      />
      {editing && (
        <DemandEditDrawer
          record={editing}
          completionOptions={completionOptions}
          onClose={() => setEditing(null)}
          onSubmit={saveEdit}
        />
      )}
    </ListContainer>
  );
}

function DemandDetailModal({
  record,
  onClose,
  onEdit,
  onTransferred,
}: {
  record: ProjectDemand | null;
  onClose: () => void;
  onEdit: () => void;
  onTransferred?: () => void;
}) {
  const rawJson = useMemo(() => {
    if (!record) return '';
    return JSON.stringify({ meta: record.rawMeta, payload: record.rawPayload }, null, 2);
  }, [record]);

  return (
    <DetailDrawer
      open={!!record}
      onClose={onClose}
      title={record?.company ?? '项目建设申请详情'}
      description={record ? `${record.projectYear ?? ''} · ${record.demandType ?? ''}` : undefined}
      width={760}
      footer={
        record ? (
          <div className="flex justify-end gap-2">
            <Can perm="demand:edit">
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
              { label: '所属年度', children: record.projectYear || '—' },
              { label: '所属单位', children: record.company || '—' },
              { label: '所属行业', children: record.industryCategory || '—' },
              { label: '需求类型', children: record.demandType || '—' },
              {
                label: '所属产品',
                children: record.product.length
                  ? record.product.map((p) => (
                      <Badge key={p} tone="info" className="mr-1">{p}</Badge>
                    ))
                  : '—',
              },
              { label: '销售经理', children: record.salesManager || '—' },
              { label: '项目经理', children: record.projectManager || '—' },
              { label: '要求完成时间', children: record.requiredFinishDate?.slice(0, 10) || '—' },
              { label: '完成情况', children: record.completionStatus || '—' },
              { label: '预计完成时间', children: record.estimatedFinishDate?.slice(0, 10) || '—' },
              {
                label: '交付内容',
                children: record.deliveryContent || '—',
                span: 2,
              },
            ]}
          />
          <Descriptions
            column={1}
            title="具体事宜及需求说明"
            items={[
              {
                label: '说明',
                children: record.demandDescHtml ? (
                  <div
                    className="prose prose-sm max-w-none rounded-sm bg-muted/30 p-3 dark:prose-invert [&_a]:text-brand"
                    dangerouslySetInnerHTML={{ __html: record.demandDescHtml }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap rounded-sm bg-muted/30 p-3 text-xs">
                    {record.demandDescText || '—'}
                  </pre>
                ),
              },
            ]}
          />
          {(record.otherDeliveryContent || record.deliveryRemark) && (
            <Descriptions
              column={1}
              title="交付备注"
              items={[
                { label: '交付内容（其他）', children: record.otherDeliveryContent || '—' },
                { label: '交付备注', children: record.deliveryRemark || '—' },
              ]}
            />
          )}
          {(record.providedMaterials.length > 0 || record.deliveryDocs.length > 0) && (
            <Descriptions
              column={1}
              title="附件"
              items={[
                {
                  label: `材料（${record.providedMaterials.length}）`,
                  children: record.providedMaterials.length ? (
                    <AttachmentList
                      files={record.providedMaterials}
                      business="demand"
                      externalId={record.id}
                      field="providedMaterials"
                      onRetried={onTransferred}
                    />
                  ) : '—',
                },
                {
                  label: `交付文档（${record.deliveryDocs.length}）`,
                  children: record.deliveryDocs.length ? (
                    <AttachmentList
                      files={record.deliveryDocs}
                      business="demand"
                      externalId={record.id}
                      field="deliveryDocs"
                      onRetried={onTransferred}
                    />
                  ) : '—',
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

function DemandEditDrawer({
  record,
  completionOptions,
  onClose,
  onSubmit,
}: {
  record: ProjectDemand;
  completionOptions: string[];
  onClose: () => void;
  onSubmit: (patch: Partial<ProjectDemand>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<ProjectDemand>>({
    completionStatus: record.completionStatus,
    estimatedFinishDate: record.estimatedFinishDate,
    deliveryContent: record.deliveryContent,
    otherDeliveryContent: record.otherDeliveryContent,
    deliveryRemark: record.deliveryRemark,
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
          <h2 className="text-base font-semibold">编辑项目建设申请</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{record.company}</p>
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
            <Field label="预计完成日期">
              <Input
                type="date"
                className="h-8 rounded-sm"
                value={draft.estimatedFinishDate?.slice(0, 10) ?? ''}
                onChange={(e) => setDraft({ ...draft, estimatedFinishDate: e.target.value || null })}
              />
            </Field>
          </div>
          <Field label="交付内容">
            <Textarea
              rows={3}
              className="rounded-sm text-sm"
              value={draft.deliveryContent ?? ''}
              onChange={(e) => setDraft({ ...draft, deliveryContent: e.target.value })}
            />
          </Field>
          <Field label="交付内容（其他）">
            <Textarea
              rows={2}
              className="rounded-sm text-sm"
              value={draft.otherDeliveryContent ?? ''}
              onChange={(e) => setDraft({ ...draft, otherDeliveryContent: e.target.value })}
            />
          </Field>
          <Field label="交付备注">
            <Textarea
              rows={3}
              className="rounded-sm text-sm"
              value={draft.deliveryRemark ?? ''}
              onChange={(e) => setDraft({ ...draft, deliveryRemark: e.target.value })}
            />
          </Field>
          {err && (
            <div className="rounded-sm border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">{err}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" className="rounded-sm" onClick={onClose} disabled={saving}>取消</Button>
          <Button size="sm" className="rounded-sm" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存修改'}</Button>
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
