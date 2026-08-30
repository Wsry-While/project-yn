'use client';
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Paperclip, ExternalLink, FileCheck2, FileX2 } from 'lucide-react';
import { showToast } from '@/lib/web/toast-store';
import { exportCsv, datedName } from '@/lib/web/csv-export';
import { apiFetch } from '@/lib/web/api-client';
import { DetailDrawer } from '@/components/crud/detail-drawer';
import { AttachmentFileLink } from '@/components/attachment-file-link';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
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
import type { QimingConstruction } from '@/lib/domain/types';
import { useServerPaginatedList } from '@/hooks/use-server-paginated-list';
import { ListContainer } from '@/components/list-container';
import { ListToolbar } from '@/components/list-toolbar';
import { EmptyState } from '@/components/crud/empty-state';
import { Descriptions } from '@/components/crud/descriptions';
import { Can } from '@/components/crud/can';

interface QimingFilters extends Record<string, string> {
  search: string;
  year: string;
  salesManager: string;
  school: string;
}

export function QimingConstructionView() {
  const [detail, setDetail] = useState<QimingConstruction | null>(null);
  const [editing, setEditing] = useState<QimingConstruction | null>(null);

  const list = useServerPaginatedList<QimingConstruction, QimingFilters>({
    endpoint: '/api/qiming-construction',
    pageSize: 20,
    initialFilters: { search: '', year: '', salesManager: '', school: '' },
    errorMessage: '加载启明星建设失败',
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

  const schoolOptions = useMemo(() => {
    const s = new Set<string>();
    list.rows.forEach((r) => r.school && s.add(r.school));
    return [...s].sort();
  }, [list.rows]);

  const reset = () => {
    list.setSearchInput('');
    list.setFilter('year', '');
    list.setFilter('salesManager', '');
    list.setFilter('school', '');
    list.setPage(1);
  };

  const handleExport = async () => {
    try {
      const all = await list.fetchAll();
      if (!all.length) {
        showToast('当前筛选结果为空', { kind: 'info' });
        return;
      }
      exportCsv(datedName('启明星建设'), [
        { header: '年度', get: (r) => r.projectYear },
        { header: '项目名称', get: (r) => r.projectName },
        { header: '学校', get: (r) => r.school },
        { header: '学院', get: (r) => r.college },
        { header: '学校层级', get: (r) => r.schoolLevel },
        { header: '建设专业', get: (r) => r.buildMajor },
        { header: '销售经理', get: (r) => r.salesManager },
        { header: '项目经理', get: (r) => r.projectManager },
        { header: '签合同', get: (r) => (r.isSignContract ? '是' : '否') },
        { header: '交付时间', get: (r) => r.projectDeliveryTime?.slice(0, 10) },
        { header: '反馈', get: (r) => r.projectStatusFeedback },
      ], all);
      showToast(`已导出 ${all.length} 条`, { kind: 'success' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败', { kind: 'error' });
    }
  };

  const saveEdit = async (patch: Partial<QimingConstruction>) => {
    if (!editing) return;
    const updated = await apiFetch<QimingConstruction>(`/api/qiming-construction/${editing.id}`, {
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
        title="启明星建设"
        subtitle={`超星表单推送，共 ${list.total} 条；本页只读，可由超管修正合同与交付信息。`}
      />
      <ListToolbar
        search={{
          value: list.searchInput,
          onChange: list.setSearchInput,
          onSubmit: () => list.setPage(1),
          placeholder: '搜索项目、学校、销售',
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
              value={list.filters.school || '__all__'}
              onValueChange={(v) => list.setFilter('school', v === '__all__' ? '' : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-[160px] rounded-sm text-xs">
                <SelectValue placeholder="学校" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部学校</SelectItem>
                {schoolOptions.map((c) => (
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
            <TableHead className="min-w-[260px]">项目 / 学校</TableHead>
            <TableHead className="w-[110px]">年度 / 层级</TableHead>
            <TableHead className="w-[160px]">销售 / 项目经理</TableHead>
            <TableHead className="w-[100px]">合同状态</TableHead>
            <TableHead className="w-[120px]">交付时间</TableHead>
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
                <EmptyState title="暂无启明星建设记录" description="等待超星表单推送数据" />
              </TableCell>
            </TableRow>
          )}
          {list.rows.map((q) => (
            <TableRow key={q.id} className="cursor-pointer" onClick={() => setDetail(q)}>
              <TableCell>
                <div className="truncate text-sm font-medium">{q.projectName || '—'}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {q.school || '—'}
                  {q.college ? ` · ${q.college}` : ''}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <div>{q.projectYear || '—'}</div>
                <div className="mt-0.5">{q.schoolLevel || '—'}</div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <div>{q.salesManager || '—'}</div>
                <div className="mt-0.5">{q.projectManager || '—'}</div>
              </TableCell>
              <TableCell>
                {q.isSignContract === true ? (
                  <Badge tone="success">
                    <FileCheck2 className="h-3 w-3" />
                    已签合同
                  </Badge>
                ) : q.isSignContract === false ? (
                  <Badge tone="warning">
                    <FileX2 className="h-3 w-3" />
                    未签合同
                  </Badge>
                ) : (
                  <Badge>—</Badge>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {q.projectDeliveryTime?.slice(0, 10) || '—'}
              </TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  {q.projectMaterials.length}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Can perm="qiming:edit">
                  <Button
                    size="xs"
                    variant="ghost"
                    className="h-7 rounded-sm px-2 text-brand"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(q);
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

      <QimingDetailModal
        record={detail}
        onClose={() => setDetail(null)}
        onEdit={() => { if (detail) { setEditing(detail); setDetail(null); } }}
        onTransferred={list.refresh}
      />
      {editing && (
        <QimingEditDrawer
          record={editing}
          onClose={() => setEditing(null)}
          onSubmit={saveEdit}
        />
      )}
    </ListContainer>
  );
}

function QimingDetailModal({
  record,
  onClose,
  onEdit,
  onTransferred,
}: {
  record: QimingConstruction | null;
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
      title={record?.projectName ?? '启明星建设详情'}
      description={record ? `${record.school ?? ''}${record.college ? ` · ${record.college}` : ''}` : undefined}
      width={760}
      footer={
        record ? (
          <div className="flex justify-end gap-2">
            <Can perm="qiming:edit">
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
              { label: '销售经理', children: record.salesManager || '—' },
              { label: '项目经理', children: record.projectManager || '—' },
              { label: '学校', children: record.school || '—' },
              { label: '学院', children: record.college || '—' },
              { label: '学校层级', children: record.schoolLevel || '—' },
              { label: '建设专业', children: record.buildMajor || '—' },
              {
                label: '是否签合同',
                children:
                  record.isSignContract === true
                    ? '已签'
                    : record.isSignContract === false
                      ? '未签'
                      : '—',
              },
              { label: '项目交付时间', children: record.projectDeliveryTime?.slice(0, 10) || '—' },
            ]}
          />
          {record.buildContentHtml || record.buildContentText ? (
            <Descriptions
              column={1}
              title="建设内容"
              items={[
                {
                  label: '说明',
                  children: record.buildContentHtml ? (
                    <div
                      className="prose prose-sm max-w-none rounded-sm bg-muted/30 p-3 dark:prose-invert [&_a]:text-brand"
                      dangerouslySetInnerHTML={{ __html: record.buildContentHtml }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap rounded-sm bg-muted/30 p-3 text-xs">
                      {record.buildContentText || '—'}
                    </pre>
                  ),
                },
              ]}
            />
          ) : null}
          {record.buildSpecialDescHtml || record.buildSpecialDescText ? (
            <Descriptions
              column={1}
              title="建设内容特殊说明及材料"
              items={[
                {
                  label: '说明',
                  children: record.buildSpecialDescHtml ? (
                    <div
                      className="prose prose-sm max-w-none rounded-sm bg-muted/30 p-3 dark:prose-invert [&_a]:text-brand"
                      dangerouslySetInnerHTML={{ __html: record.buildSpecialDescHtml }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap rounded-sm bg-muted/30 p-3 text-xs">
                      {record.buildSpecialDescText || '—'}
                    </pre>
                  ),
                },
              ]}
            />
          ) : null}
          <Descriptions
            column={1}
            title="项目情况反馈"
            items={[{ label: '反馈', children: record.projectStatusFeedback || '—' }]}
          />
          {record.projectMaterials.length > 0 && (
            <Descriptions
              column={1}
              title={`项目相关资料（${record.projectMaterials.length}）`}
              items={[
                {
                  label: '附件',
                  children: (
                    <div className="space-y-1.5">
                      {record.projectMaterials.map((f, i) => (
                        <AttachmentFileLink
                          key={f.assetId || f.objectId || i}
                          file={f}
                          business="qiming"
                          recordId={record.id}
                          field="projectMaterials"
                          onTransferred={onTransferred}
                        />
                      ))}
                    </div>
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

function QimingEditDrawer({
  record,
  onClose,
  onSubmit,
}: {
  record: QimingConstruction;
  onClose: () => void;
  onSubmit: (patch: Partial<QimingConstruction>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<QimingConstruction>>({
    isSignContract: record.isSignContract,
    buildMajor: record.buildMajor,
    projectDeliveryTime: record.projectDeliveryTime,
    projectStatusFeedback: record.projectStatusFeedback,
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
          <h2 className="text-base font-semibold">编辑启明星建设</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{record.projectName}</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="是否签合同">
              <Select
                value={
                  draft.isSignContract === true ? '1'
                    : draft.isSignContract === false ? '0' : ''
                }
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    isSignContract: v === '1' ? true : v === '0' ? false : null,
                  })
                }
              >
                <SelectTrigger className="h-8 rounded-sm"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">已签</SelectItem>
                  <SelectItem value="0">未签</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="项目交付时间">
              <Input
                type="datetime-local"
                className="h-8 rounded-sm"
                value={toLocalInputValue(draft.projectDeliveryTime)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    projectDeliveryTime: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
              />
            </Field>
          </div>
          <Field label="建设专业">
            <Input
              className="h-8 rounded-sm"
              value={draft.buildMajor ?? ''}
              onChange={(e) => setDraft({ ...draft, buildMajor: e.target.value || null })}
            />
          </Field>
          <Field label="项目情况反馈">
            <Textarea
              rows={5}
              className="rounded-sm text-sm"
              value={draft.projectStatusFeedback ?? ''}
              onChange={(e) => setDraft({ ...draft, projectStatusFeedback: e.target.value })}
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

function toLocalInputValue(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
