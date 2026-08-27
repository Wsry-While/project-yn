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
  Pencil,
} from 'lucide-react';
import { tripWebService } from '@/lib/web/trip-web-service';
import { showToast } from '@/lib/web/toast-store';
import { exportCsv, datedName } from '@/lib/web/csv-export';
import { apiFetch } from '@/lib/web/api-client';
import { Modal } from '@/components/modal';
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
import type { TripOptionDict, TripRequest } from '@/lib/domain/types';
import { useServerPaginatedList } from '@/hooks/use-server-paginated-list';
import { ListContainer } from '@/components/list-container';
import { ListToolbar } from '@/components/list-toolbar';
import { EmptyState } from '@/components/crud/empty-state';
import { Descriptions } from '@/components/crud/descriptions';
import { Can } from '@/components/crud/can';
import { cn } from '@/lib/utils';

interface TripFilters extends Record<string, string> {
  search: string;
  supportType: string;
  year: string;
}

export function TripsView() {
  const [options, setOptions] = useState<TripOptionDict[]>([]);
  const [detail, setDetail] = useState<TripRequest | null>(null);
  const [editing, setEditing] = useState<TripRequest | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const list = useServerPaginatedList<TripRequest, TripFilters>({
    endpoint: '/api/trips',
    pageSize: 20,
    initialFilters: { search: '', supportType: '', year: '' },
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

  useEffect(() => {
    if (!detail) return;
    const fresh = list.rows.find((r) => r.id === detail.id);
    if (fresh) setDetail(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.rows]);

  const years = useMemo(() => {
    const s = new Set<number>();
    list.rows.forEach((r) => r.year && s.add(r.year));
    return [...s].sort((a, b) => b - a);
  }, [list.rows]);

  const reset = () => {
    list.setSearchInput('');
    list.setFilter('supportType', '');
    list.setFilter('year', '');
    list.setPage(1);
  };

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
        { header: '产品', get: (r) => r.products.join('、') },
        { header: '外出日期', get: (r) => r.tripDate?.slice(0, 10) },
        { header: '销售经理', get: (r) => r.salesManager?.name },
        { header: '项目经理', get: (r) => r.projectManager?.name },
        { header: '是否完成', get: (r) => (r.isCompleted ? '是' : '否') },
        { header: '综合评分', get: (r) => r.overallScore },
        { header: '整体评价', get: (r) => r.overallFeedback?.text },
      ], all);
      showToast(`已导出 ${all.length} 条项目外出记录`, { kind: 'success' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败', { kind: 'error' });
    }
  };

  const saveEdit = async (patch: Partial<TripRequest>) => {
    if (!editing) return;
    const body: Record<string, unknown> = {};
    if ('isCompleted' in patch) body.isCompleted = patch.isCompleted;
    if ('reportConsistent' in patch) body.reportConsistent = patch.reportConsistent;
    if ('salesScore' in patch) body.salesScore = patch.salesScore;
    if ('overallScore' in patch) body.overallScore = patch.overallScore;
    if (patch.serviceSummary?.text !== undefined) body.serviceSummaryText = patch.serviceSummary.text;
    if (patch.overallFeedback?.text !== undefined) body.overallFeedbackText = patch.overallFeedback.text;
    const updated = await apiFetch<TripRequest>(`/api/trips/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setEditing(null);
    setDetail(updated);
    list.refresh();
    showToast('已保存修改', { kind: 'success' });
  };

  return (
    <ListContainer>
      <PageHeader
        title="项目外出"
        subtitle={`数据由超星表单推送驱动，共 ${list.total} 条记录；本页仅查看与筛选。`}
      />
      <ListToolbar
        search={{
          value: list.searchInput,
          onChange: list.setSearchInput,
          onSubmit: () => list.setPage(1),
          placeholder: '搜索学校、支持人员、事宜',
        }}
        filters={
          <>
            <Select
              value={list.filters.supportType || '__all__'}
              onValueChange={(v) => list.setFilter('supportType', v === '__all__' ? '' : v)}
            >
              <SelectTrigger size="sm" className="h-8 w-[140px] rounded-sm text-xs">
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
                  <SelectItem key={y} value={String(y)}>
                    {y} 年
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        onSubmit={() => list.setPage(1)}
        onReset={reset}
        onRefresh={refresh}
        refreshing={list.loading}
        onExport={handleExport}
        exportDisabled={list.total === 0}
        total={list.total}
      />

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-muted/60">
            <TableHead className="min-w-[260px]">学校 / 事宜</TableHead>
            <TableHead className="w-[140px]">类型</TableHead>
            <TableHead className="w-[180px]">外出时间</TableHead>
            <TableHead className="w-[160px]">销售 / 项目经理</TableHead>
            <TableHead className="w-[100px]">状态</TableHead>
            <TableHead className="w-[120px] text-right">同步时间</TableHead>
            <TableHead className="w-[80px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.loading && list.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="py-16 text-center text-muted-foreground">
                加载中…
              </TableCell>
            </TableRow>
          )}
          {!list.loading && list.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <EmptyState title="暂无项目外出记录" description="可尝试调整筛选条件或等待超星表单推送" />
              </TableCell>
            </TableRow>
          )}
          {list.rows.map((t) => {
            const meta = APPROVAL_META[t.approvalStatus];
            const Icon = meta.icon;
            const isFocus = focusId === t.id;
            return (
              <TableRow
                key={t.id}
                data-state={isFocus ? 'selected' : undefined}
                className="cursor-pointer"
                onClick={() => setDetail(t)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{t.schoolName}</span>
                    {t.industry && (
                      <span className="hidden shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground lg:inline">
                        {t.industry}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {t.detail?.text || '—'}
                  </p>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs">
                    <Plane className="h-3 w-3" />
                    {t.supportType}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
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
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div className="inline-flex items-center gap-1">
                    <UserRound className="h-3 w-3" />
                    {t.salesManager?.name ?? '未指派'}
                  </div>
                  <div className="mt-0.5 inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {t.projectManager?.name ?? '未指派'}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge tone={APPROVAL_TONE[t.approvalStatus]}>
                    {Icon ? <Icon className="h-3 w-3" /> : null}
                    {meta.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {formatSyncedAt(t.syncedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Can perm="trip:edit">
                    <Button
                      size="xs"
                      variant="ghost"
                      className="h-7 rounded-sm px-2 text-brand"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(t);
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
          <Pagination
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPageChange={list.setPage}
          />
        </div>
      )}

      <TripDetailModal trip={detail} onClose={() => setDetail(null)} onEdit={() => { if (detail) { setEditing(detail); setDetail(null); } }} />
      <TripEditDrawer record={editing} onClose={() => setEditing(null)} onSubmit={saveEdit} />
    </ListContainer>
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

function RichTextBlock({ value }: { value: TripRequest['detail'] }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  if (value.html) {
    return (
      <div
        className="rounded-sm border-l-2 border-brand/40 bg-muted/30 px-3 py-2 text-sm prose prose-sm max-w-none dark:prose-invert [&_a]:text-brand [&_li]:m-0 [&_ol]:pl-5 [&_p]:my-1 [&_ul]:pl-5"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: value.html }}
      />
    );
  }
  return <p className="whitespace-pre-wrap text-sm text-muted-foreground">{value.text}</p>;
}

function TripDetailModal({
  trip,
  onClose,
  onEdit,
}: {
  trip: TripRequest | null;
  onClose: () => void;
  onEdit: () => void;
}) {
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
      footer={
        trip ? (
          <div className="flex justify-end gap-2">
            <Can perm="trip:edit">
              <Button size="sm" className="rounded-sm" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </Button>
            </Can>
          </div>
        ) : null
      }
    >
      {trip && (
        <div className="space-y-4">
          <Descriptions
            column={3}
            items={[
              { label: '编号', children: trip.externalSerial ?? trip.externalId },
              { label: '所属年度', children: trip.year ?? '—' },
              {
                label: '审批状态',
                children: (
                  <Badge tone={APPROVAL_TONE[trip.approvalStatus]}>
                    {APPROVAL_META[trip.approvalStatus].label}
                  </Badge>
                ),
              },
              { label: '学校', children: trip.schoolName },
              { label: '所属行业', children: trip.industry ?? '—' },
              {
                label: '支持类型',
                children: `${trip.supportType}${trip.supportTypeOther ? `（${trip.supportTypeOther}）` : ''}`,
              },
              {
                label: '外出日期',
                children: `${trip.tripDate} ${weekdayLabel(trip.weekday)}`,
              },
              { label: '开始时间', children: formatDateTime(trip.startAt) || '—' },
              { label: '结束时间', children: formatDateTime(trip.endAt) || '—' },
              { label: '销售经理', children: trip.salesManager?.name ?? '—' },
              { label: '项目经理', children: trip.projectManager?.name ?? '—' },
              {
                label: '所属产品',
                children: trip.products.length ? (
                  <div className="flex flex-wrap gap-1">
                    {trip.products.map((p) => (
                      <span key={p} className="rounded-sm bg-muted px-1.5 py-0.5 text-xs">
                        {p}
                      </span>
                    ))}
                  </div>
                ) : (
                  '—'
                ),
              },
            ]}
          />

          <Descriptions
            column={1}
            title="具体事宜"
            items={[{ label: '详情', children: <RichTextBlock value={trip.detail} /> }]}
          />

          <Descriptions
            column={4}
            title="外出反馈"
            items={[
              { label: '是否完成', children: yesNo(trip.isCompleted) },
              { label: '汇报一致', children: yesNo(trip.reportConsistent) },
              { label: '销售迟到', children: yesNo(trip.salesLate) },
              { label: '服务迟到', children: yesNo(trip.serviceLate) },
              { label: '销售评分', children: trip.salesScore ?? '—' },
              { label: '综合评分', children: trip.overallScore ?? '—' },
              {
                label: '完成时间',
                children: trip.completedAt ? formatSyncedAt(trip.completedAt) : '—',
              },
              { label: ' ', children: ' ' },
            ]}
          >
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs text-muted-foreground">服务内容简述</div>
                <RichTextBlock value={trip.serviceSummary} />
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">整体评价 / 跟进</div>
                <RichTextBlock value={trip.overallFeedback} />
              </div>
            </div>
          </Descriptions>

          <details className="rounded-md border border-border bg-muted/20 p-3">
            <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
              超星同步元数据
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-sm bg-background p-2 text-[11px] leading-relaxed text-muted-foreground">
              {rawJson}
            </pre>
          </details>
        </div>
      )}
    </Modal>
  );
}

function TripEditDrawer({
  record,
  onClose,
  onSubmit,
}: {
  record: TripRequest | null;
  onClose: () => void;
  onSubmit: (patch: Partial<TripRequest>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<TripRequest>>({});
  const [summaryText, setSummaryText] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (record) {
      setDraft({
        isCompleted: record.isCompleted,
        reportConsistent: record.reportConsistent ?? false,
        salesScore: record.salesScore,
        overallScore: record.overallScore,
      });
      setSummaryText(record.serviceSummary?.text ?? '');
      setFeedbackText(record.overallFeedback?.text ?? '');
      setErr(null);
    }
  }, [record]);

  if (!record) return null;

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onSubmit({
        ...draft,
        serviceSummary: { text: summaryText } as TripRequest['serviceSummary'],
        overallFeedback: { text: feedbackText } as TripRequest['overallFeedback'],
      });
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
          <h2 className="text-base font-semibold">编辑外出记录</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{record.schoolName} · {record.tripDate}</p>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="是否完成">
              <Select
                value={draft.isCompleted ? '1' : '0'}
                onValueChange={(v) => setDraft({ ...draft, isCompleted: v === '1' })}
              >
                <SelectTrigger className="h-8 rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">已完成</SelectItem>
                  <SelectItem value="0">未完成</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="汇报一致">
              <Select
                value={draft.reportConsistent ? '1' : '0'}
                onValueChange={(v) => setDraft({ ...draft, reportConsistent: v === '1' })}
              >
                <SelectTrigger className="h-8 rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">是</SelectItem>
                  <SelectItem value="0">否</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="销售评分（0-5）">
              <Input
                type="number" min={0} max={5}
                className="h-8 rounded-sm"
                value={draft.salesScore ?? ''}
                onChange={(e) => setDraft({ ...draft, salesScore: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label="综合评分（0-5）">
              <Input
                type="number" min={0} max={5}
                className="h-8 rounded-sm"
                value={draft.overallScore ?? ''}
                onChange={(e) => setDraft({ ...draft, overallScore: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="服务内容简述">
            <Textarea
              rows={4}
              className="rounded-sm text-sm"
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
            />
          </Field>
          <Field label="整体评价 / 跟进">
            <Textarea
              rows={4}
              className="rounded-sm text-sm"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
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

function yesNo(v: boolean | null): string {
  if (v === true) return '是';
  if (v === false) return '否';
  return '—';
}

// 抑制 cn 未使用警告（保留 import 便于将来扩展）
void cn;
