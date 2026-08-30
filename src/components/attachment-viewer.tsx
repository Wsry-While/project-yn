'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/modal';
import { OfficePreview } from '@/components/office-preview';
import { apiFetch, ApiError } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import type { BiddingFileRef } from '@/lib/domain/types';

/**
 * 附件在线预览 + 失败重试。
 *
 * - 已转存（stored/direct）的图片/PDF 直接在弹窗内 iframe/img 预览；
 *   Office 等浏览器无法内联的类型提供下载与 Office Online 兜底。
 * - pending/failed 状态展示「重新获取」，调用 /api/files/:id/retry。
 * 四大业务（招投标/建设申请/启明星/外出如有附件）共用。
 */

type PreviewKind = 'image' | 'pdf' | 'office' | 'video' | 'audio' | 'other';

interface AssetMeta {
  id: string;
  fileName: string;
  contentType: string | null;
  byteSize: number | null;
  status: 'pending' | 'fetching' | 'stored' | 'failed' | 'direct';
  errorMessage: string | null;
  retryCount: number;
  previewKind: PreviewKind;
  previewUrl: string;
  downloadUrl: string;
  retryUrl: string;
}

function statusBadge(status: AssetMeta['status']): { label: string; className: string } | null {
  switch (status) {
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

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentLink({
  file,
  fallbackLabel = '附件',
  variant = 'clip',
  externalId,
  field,
  business,
  onRetried,
}: {
  file: BiddingFileRef | null | undefined;
  fallbackLabel?: string;
  variant?: 'clip' | 'doc';
  /** 业务记录 ID，用于 objectId 兜底转存回写（招投标=记录 id）。 */
  externalId?: string;
  field?: string;
  /** 业务线，缺省按 externalId+field 推断；objectId 兜底转存时需要。 */
  business?: 'bidding' | 'demand' | 'qiming';
  onRetried?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [acquiring, setAcquiring] = useState(false);

  // 提前用 useCallback 固定引用，避免在 `if (!file) return` 之后调用 Hook。
  const handleAcquire = useCallback(async () => {
    if (!file || !business || !externalId || !field) return;
    // 顶层 objectId 或 url 里的 objectid 二者居一即可（后端 resolveObjectId 兜底）。
    const hasTopOid = /^[a-f0-9]{32}$/i.test(file.objectId || '');
    const hasUrlOid =
      /objectid=[a-f0-9]{32}/i.test(file.url || '') || /chaoxing\.com|cldisk\.com|chaoxing\.cn/i.test(file.url || '');
    if (!hasTopOid && !hasUrlOid) return;
    setAcquiring(true);
    try {
      const result = await apiFetch<{ ok: boolean; status?: string; error?: string }>('/api/files/transfer', {
        method: 'POST',
        body: JSON.stringify({
          business,
          recordId: externalId,
          field,
          objectId: file.objectId || undefined,
          url: file.url || undefined,
        }),
      });
      if (result.ok) {
        showToast(result.status === 'direct' ? '文件较大，已切换为超星直链' : '附件已获取，正在刷新', {
          kind: 'success',
        });
        onRetried?.();
      } else {
        showToast(result.error || '获取附件失败，请稍后再试', { kind: 'error' });
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '获取附件失败', { kind: 'error' });
    } finally {
      setAcquiring(false);
    }
  }, [file, business, externalId, field, onRetried]);

  if (!file) return <span className="text-muted-foreground">—</span>;

  const name = file.name || fallbackLabel;
  const hasAsset = !!file.assetId;
  const url = file.url || '';
  // 超星文件：顶层 objectId，或 url 指向超星域名/带 objectid 参数。
  // 不能仅凭 url 里任意 32 位 hex 判断（第三方外链文件名 hash 也会命中）。
  const isChaoxingUrl =
    /objectid=[a-f0-9]{32}/i.test(url) || /chaoxing\.com|cldisk\.com|chaoxing\.cn/i.test(url);
  const hasObjectId = !!file.objectId || isChaoxingUrl;
  const failed = file.storageStatus === 'failed';
  const pending = file.storageStatus === 'pending' || file.storageStatus === 'fetching';
  // 是否已转存到本系统：stored/direct 都算可预览（direct 为超大文件降级）。
  const stored = hasAsset && (file.storageStatus === 'stored' || file.storageStatus === 'direct');
  // 可就地「获取/重试」：有 objectId 且知道业务线+记录+字段。
  const canAcquire =
    hasObjectId &&
    !!business &&
    !!externalId &&
    !!field &&
    file.storageStatus !== 'stored' &&
    file.storageStatus !== 'direct' &&
    !acquiring;
  // 名称可点击：已转存（打开本系统预览），或可触发获取。
  const clickable = stored || canAcquire || (!!file.url && !hasObjectId);

  const handleNameClick = () => {
    if (stored) {
      setOpen(true);
    } else if (canAcquire) {
      void handleAcquire();
    } else if (file.url && !hasObjectId) {
      window.open(file.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <>
      <span className="inline-flex max-w-full items-center gap-1.5 text-sm">
        <button
          type="button"
          disabled={!clickable}
          onClick={handleNameClick}
          className={cn(
            'inline-flex min-w-0 items-center gap-1.5 transition-colors',
            clickable
              ? stored
                ? 'text-brand hover:underline'
                : 'text-brand hover:underline'
              : failed
                ? 'cursor-pointer text-red-500 hover:underline'
                : 'text-muted-foreground',
            !clickable && 'cursor-not-allowed opacity-60',
          )}
          title={
            acquiring
              ? '正在获取附件…'
              : stored
                ? name
                : canAcquire
                  ? '点击获取本系统可预览的附件'
                  : file.storageError ?? name
          }
        >
          {variant === 'doc' ? (
            <FileText className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Paperclip className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">{name}</span>
          {pending && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
          {failed && <span className="text-[10px] text-red-500">(获取失败)</span>}
          {!stored && canAcquire && !failed && !pending && (
            <span className="shrink-0 text-[10px] text-brand/80">(未获取)</span>
          )}
        </button>
        {canAcquire ? (
          <button
            type="button"
            onClick={handleAcquire}
            disabled={acquiring}
            className="inline-flex shrink-0 items-center gap-0.5 rounded border border-brand/30 px-1.5 py-0.5 text-[10px] font-medium text-brand hover:bg-brand/10 disabled:opacity-60"
          >
            {acquiring ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
            {failed ? '重试' : pending ? '获取中' : '获取'}
          </button>
        ) : null}
        {acquiring && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            正在从超星获取…
          </span>
        )}
      </span>

      {hasAsset && (
        <PreviewModal
          assetId={file.assetId!}
          open={open}
          onClose={() => setOpen(false)}
          externalId={externalId}
          field={field}
          onRetried={onRetried}
        />
      )}
    </>
  );
}

export function AttachmentList({
  files,
  externalId,
  field,
  business,
  onRetried,
}: {
  files: BiddingFileRef[] | null | undefined;
  externalId?: string;
  field?: string;
  business?: 'bidding' | 'demand' | 'qiming';
  onRetried?: () => void;
}) {
  if (!files || files.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {files.map((file, i) => (
        <AttachmentLink
          key={file.objectId ?? file.assetId ?? file.url ?? i}
          file={file}
          fallbackLabel={`附件 ${i + 1}`}
          externalId={externalId}
          field={field}
          business={business}
          onRetried={onRetried}
        />
      ))}
    </div>
  );
}

function PreviewModal({
  assetId,
  open,
  onClose,
  externalId,
  field,
  onRetried,
}: {
  assetId: string;
  open: boolean;
  onClose: () => void;
  externalId?: string;
  field?: string;
  onRetried?: () => void;
}) {
  const [meta, setMeta] = useState<AssetMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [nonce, setNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<AssetMeta>(`/api/files/meta/${assetId}`);
      setMeta(data);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '加载附件信息失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    if (open) {
      void load();
      setNonce((n) => n + 1);
    }
  }, [open, load]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const result = await apiFetch<{ ok: boolean; status: string; error?: string }>(
        `/api/files/${assetId}/retry`,
        {
          method: 'POST',
          body: JSON.stringify({ externalId, field }),
        },
      );
      if (result.ok) {
        showToast('附件已重新获取', { kind: 'success' });
        await load();
        onRetried?.();
      } else {
        showToast(result.error || '转存仍未成功，请稍后再试', { kind: 'error' });
        await load();
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '重新获取失败', { kind: 'error' });
    } finally {
      setRetrying(false);
    }
  };

  const badge = meta ? statusBadge(meta.status) : null;
  const ready = meta && (meta.status === 'stored' || meta.status === 'direct');
  const sizeText = meta ? formatSize(meta.byteSize) : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meta?.fileName || '附件预览'}
      size="xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {sizeText}
            {meta?.errorMessage ? ` · ${meta.errorMessage}` : ''}
          </span>
          <div className="flex items-center gap-2">
            {meta?.status === 'failed' || meta?.status === 'pending' ? (
              <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
                {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                重新获取
              </Button>
            ) : null}
            {ready && (
              <a href={meta!.downloadUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5" />
                  下载
                </Button>
              </a>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {badge ? (
            <span className={cn('rounded px-2 py-0.5 text-[11px] font-medium', badge.className)}>{badge.label}</span>
          ) : null}
          {meta && ready ? (
            <span className="text-xs text-muted-foreground">
              {meta.status === 'direct' ? '超星直链（实时签名）' : '已转存至对象存储'}
            </span>
          ) : null}
        </div>

        {loading && !meta ? (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载附件…
          </div>
        ) : null}

        {meta && !ready ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              {meta.status === 'failed'
                ? '该附件转存失败，可能是超星链接失效或文件过大。'
                : '该附件尚未转存完成。'}
            </p>
            <Button size="sm" onClick={handleRetry} disabled={retrying}>
              {retrying ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              {meta.status === 'failed' ? '重新获取' : '立即获取'}
            </Button>
          </div>
        ) : null}

        {meta && ready ? <PreviewBody meta={meta} nonce={nonce} /> : null}
      </div>
    </Modal>
  );
}

function PreviewBody({ meta, nonce }: { meta: AssetMeta; nonce: number }) {
  const { previewKind, previewUrl, downloadUrl, fileName } = meta;
  // 加 nonce 绕过浏览器缓存，重试后能刷新。
  const src = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_=${nonce}`;

  if (previewKind === 'image') {
    return (
      <div className="flex max-h-[70vh] justify-center overflow-auto rounded-md bg-muted/30 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={fileName} className="max-h-[68vh] object-contain" />
      </div>
    );
  }
  if (previewKind === 'pdf') {
    return <iframe title={fileName} src={src} className="h-[70vh] w-full rounded-md border bg-white" />;
  }
  if (previewKind === 'video') {
    return <video src={src} controls className="max-h-[70vh] w-full rounded-md bg-black" />;
  }
  if (previewKind === 'audio') {
    return <audio src={src} controls className="w-full" />;
  }
  if (previewKind === 'office') {
    // 开源纯前端预览：docx → docx-preview，xls/xlsx/csv → SheetJS；其余格式下载兜底。
    return <OfficePreview src={previewUrl} fileName={fileName} downloadUrl={downloadUrl} nonce={nonce} />;
  }
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">该文件类型不支持在线预览。</p>
      <a href={downloadUrl} target="_blank" rel="noreferrer">
        <Button size="sm">
          <Download className="mr-1 h-3.5 w-3.5" />
          下载文件
        </Button>
      </a>
    </div>
  );
}

/** 紧凑的附件徽标，用于表格单元格（只显示数量，点击打开首个）。 */
export function AttachmentChip({ files, onOpen }: { files: BiddingFileRef[]; onOpen?: () => void }) {
  if (!files.length) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
    >
      <Paperclip className="h-3.5 w-3.5" />
      {files.length} 个
    </button>
  );
}
