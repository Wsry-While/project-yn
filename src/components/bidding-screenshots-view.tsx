'use client';
import { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  UserRound,
} from 'lucide-react';
import { biddingScreenshotWebService } from '@/lib/web/bidding-screenshot-web-service';
import { showToast } from '@/lib/web/toast-store';
import { exportCsv, datedName } from '@/lib/web/csv-export';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Modal } from '@/components/modal';
import { AttachmentList, AttachmentLink } from '@/components/attachment-viewer';
import { BiddingAiPanel } from '@/components/bidding-ai-panel';
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
import type { BiddingScreenshot } from '@/lib/domain/types';
import { useServerPaginatedList } from '@/hooks/use-server-paginated-list';
import { ListContainer, ListBody, ListEmpty } from '@/components/list-container';
import { ListToolbar } from '@/components/list-toolbar';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

interface BiddingFilters extends Record<string, string> {
  search: string;
  completionStatus: string;
  overdue: string;
}

type BadgeTone = 'success' | 'warning' | 'brand' | 'neutral' | 'danger';
const STATUS_TONE: Record<string, BadgeTone> = {
  已完成: 'success',
  已交付: 'success',
  待交付: 'warning',
  处理中: 'brand',
};

const STATUS_OPTIONS = ['已完成', '已交付', '待交付', '处理中'];

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

export function BiddingScreenshotsView() {
  const [detail, setDetail] = useState<BiddingScreenshot | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const list = useServerPaginatedList<BiddingScreenshot, BiddingFilters>({
    endpoint: '/api/bidding-screenshots',
    pageSize: PAGE_SIZE,
    initialFilters: { search: '', completionStatus: '', overdue: '' },
    errorMessage: '加载招投标截图失败',
  });

  const refresh = () => list.refresh();

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focus');
    if (focus) setFocusId(focus);
  }, []);

  // 详情弹窗数据随列表刷新同步（附件转存状态等）
  useEffect(() => {
    if (!detail) return;
    const fresh = list.rows.find((r) => r.id === detail.id);
    if (fresh) setDetail(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.rows]);

  const overdueOnly = list.filters.overdue === '1';

  const handleExport = async () => {
    try {
      const all = await list.fetchAll();
      if (all.length === 0) {
        showToast('当前筛选结果为空，无法导出', { kind: 'info' });
        return;
      }
      exportCsv(datedName('招投标截图'), [
        { header: '项目名称', get: (r) => r.projectName },
        { header: '学校', get: (r) => r.projectSchool },
        { header: '二级单位', get: (r) => r.projectSecondaryUnit },
        { header: '销售经理', get: (r) => r.salesManager },
        { header: '项目经理', get: (r) => r.assignedProjectManager },
        { header: '类别', get: (r) => r.projectCategory.join('、') },
        { header: '是否公司参数', get: (r) => (r.isCompanyParameter ? '是' : '否') },
        { header: '提交日期', get: (r) => r.submissionDate },
        { header: '需交付日期', get: (r) => r.dueDeliveryDate },
        { header: '预留天数', get: (r) => r.reservedDays },
        { header: '完成状态', get: (r) => r.completionStatus },
        { header: '是否满足截图需求', get: (r) =>
          r.isMeetScreenshotRequirement === null ? '' : r.isMeetScreenshotRequirement ? '是' : '否' },
        { header: '交付备注', get: (r) => r.deliveryRemark },
        { header: '销售反馈', get: (r) => r.salesFeedback },
        { header: '整改反馈', get: (r) => r.rectificationFeedback },
        { header: '附件数', get: (r) => r.attachments.length },
      ], all);
      showToast(`已导出 ${all.length} 条招投标记录`, { kind: 'success' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导出失败', { kind: 'error' });
    }
  };

  return (
    <LlmLoadingMask loading={list.loading} label="加载招投标截图…" className="min-h-[70vh]">
      <ListContainer>
        <PageHeader
          icon={FileText}
          title="招投标截图"
          subtitle={`数据由第三方系统推送，共 ${list.total} 条，系统内仅查看与筛选。`}
          breadcrumb={[{ label: '工作台' }, { label: '招投标截图' }]}
        />

        <ListToolbar
          search={{
            value: list.searchInput,
            onChange: list.setSearchInput,
            placeholder: '搜索项目、学校、销售',
          }}
          filters={
            <>
              <Select
                value={list.filters.completionStatus || '__all__'}
                onValueChange={(v) => list.setFilter('completionStatus', v === '__all__' ? '' : v)}
              >
                <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="完成状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部状态</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => list.setFilter('overdue', overdueOnly ? '' : '1')}
                className={cn(
                  'h-8 rounded-md border px-2.5 text-xs transition',
                  overdueOnly
                    ? 'border-status-danger/40 bg-status-danger/10 text-status-danger'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                仅逾期
              </button>
            </>
          }
          onRefresh={refresh}
          refreshing={list.loading}
          onExport={handleExport}
          exportDisabled={list.total === 0}
          total={list.total}
        />

        <div className="hidden grid-cols-[1.4fr_1fr_.9fr_.9fr_.8fr_.8fr] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>项目 / 学校</span>
          <span>销售 / 项目经理</span>
          <span>提交 / 截止</span>
          <span>类别 / 文件</span>
          <span>状态</span>
          <span className="text-right">预留天数</span>
        </div>
        <ListBody>
          {list.rows.map((row) => {
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
          {list.rows.length === 0 && !list.loading && (
            <ListEmpty>暂无招投标截图记录</ListEmpty>
          )}
        </ListBody>
        {list.totalPages > 1 && (
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        )}
      </ListContainer>

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
              <Detail label="项目招标文件"><AttachmentLink file={detail.projectBiddingFile} fallbackLabel="项目招标文件" variant="doc" business="bidding" externalId={detail.id} field="projectBiddingFile" onRetried={refresh} /></Detail>
              <Detail label="交付文档上传"><AttachmentLink file={detail.deliveryDocument} fallbackLabel="交付文档" variant="doc" business="bidding" externalId={detail.id} field="deliveryDocument" onRetried={refresh} /></Detail>
              <Detail label="整改后文档"><AttachmentLink file={detail.rectifiedDocument} fallbackLabel="整改后文档" variant="doc" business="bidding" externalId={detail.id} field="rectifiedDocument" onRetried={refresh} /></Detail>
              <Detail label="附件材料"><AttachmentList files={detail.attachments} business="bidding" externalId={detail.id} field="attachments" onRetried={refresh} /></Detail>
            </div>
            <BiddingAiPanel record={detail} />
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
