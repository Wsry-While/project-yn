'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/modal';
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

function officeViewerUrl(downloadUrl: string): string {
  // Office Online 需要公网可达的 URL；这里传我们自己的下载跳转地址（会 307 到签名 URL）。
  if (typeof window === 'undefined') return '';
  const abs = new URL(downloadUrl, window.location.origin).toString();
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(abs)}`;
}

export function AttachmentLink({
  file,
  fallbackLabel = '附件',
  variant = 'clip',
  externalId,
  field,
  onRetried,
}: {
  file: BiddingFileRef | null | undefined;
  fallbackLabel?: string;
  variant?: 'clip' | 'doc';
  externalId?: string;
  field?: string;
  onRetried?: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (!file) return <span className="text-muted-foreground">—</span>;

  const name = file.name || fallbackLabel;
  const hasAsset = !!file.assetId;
  const failed = file.storageStatus === 'failed';
  const pending = file.storageStatus === 'pending' || file.storageStatus === 'fetching';
  const canOpen = hasAsset && file.storageStatus !== 'failed';

  return (
    <>
      <button
        type="button"
        disabled={!hasAsset && !file.url}
        onClick={() => hasAsset && setOpen(true)}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 text-sm transition-colors',
          canOpen
            ? 'text-brand hover:underline'
            : failed
              ? 'cursor-pointer text-red-500 hover:underline'
              : 'text-muted-foreground',
          !hasAsset && !file.url && 'cursor-not-allowed opacity-60',
        )}
        title={file.storageError ?? name}
      >
        {variant === 'doc' ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <Paperclip className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{name}</span>
        {failed && <span className="text-[10px] text-red-500">(点击重试)</span>}
        {pending && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
      </button>

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
      {!hasAsset && file.url && (
        <a href={file.url} target="_blank" rel="noreferrer" className="sr-only" aria-hidden>
          {name}
        </a>
      )}
    </>
  );
}

export function AttachmentList({
  files,
  externalId,
  field,
  onRetried,
}: {
  files: BiddingFileRef[] | null | undefined;
  externalId?: string;
  field?: string;
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
  const [officeOpen, setOfficeOpen] = useState(false);

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
      setOfficeOpen(false);
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

        {meta && ready ? (
          <PreviewBody meta={meta} nonce={nonce} officeOpen={officeOpen} onOffice={() => setOfficeOpen(true)} />
        ) : null}
      </div>
    </Modal>
  );
}

function PreviewBody({
  meta,
  nonce,
  officeOpen,
  onOffice,
}: {
  meta: AssetMeta;
  nonce: number;
  officeOpen: boolean;
  onOffice: () => void;
}) {
  const { previewKind, previewUrl, downloadUrl } = meta;
  // 加 nonce 绕过浏览器缓存，重试后能刷新。
  const src = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_=${nonce}`;

  if (previewKind === 'image') {
    return (
      <div className="flex max-h-[70vh] justify-center overflow-auto rounded-md bg-muted/30 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={meta.fileName} className="max-h-[68vh] object-contain" />
      </div>
    );
  }
  if (previewKind === 'pdf') {
    return <iframe title={meta.fileName} src={src} className="h-[70vh] w-full rounded-md border bg-white" />;
  }
  if (previewKind === 'video') {
    return <video src={src} controls className="max-h-[70vh] w-full rounded-md bg-black" />;
  }
  if (previewKind === 'audio') {
    return <audio src={src} controls className="w-full" />;
  }
  if (previewKind === 'office') {
    return (
      <div className="space-y-3">
        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-md border border-dashed text-center">
          <FileText className="h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">Office 文档无法在浏览器内直接渲染。</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onOffice}>
              <Eye className="mr-1 h-3.5 w-3.5" />
              使用 Office Online 预览
            </Button>
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              <Button size="sm">
                <Download className="mr-1 h-3.5 w-3.5" />
                下载原文件
              </Button>
            </a>
          </div>
        </div>
        {officeOpen ? (
          <div className="relative">
            <a
              href={officeViewerUrl(downloadUrl)}
              target="_blank"
              rel="noreferrer"
              className="mb-2 inline-flex items-center gap-1 text-xs text-brand hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              若下方未加载，点此在新窗口打开
            </a>
            <iframe
              title="office-preview"
              src={officeViewerUrl(downloadUrl)}
              className="h-[60vh] w-full rounded-md border"
            />
          </div>
        ) : null}
      </div>
    );
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
