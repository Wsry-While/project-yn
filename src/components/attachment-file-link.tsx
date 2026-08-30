'use client';

import { useState } from 'react';
import { Paperclip, Download, RefreshCw, ExternalLink } from 'lucide-react';
import type { BiddingFileRef } from '@/lib/domain/types';
import { apiFetch } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';

type Business = 'bidding' | 'demand' | 'qiming';

interface TransferResult {
  ok: boolean;
  status?: string;
  assetId?: string;
  error?: string;
}

/**
 * 统一的附件链接渲染：
 * - 已转存（有 assetId）：走我方 `/api/files/preview/:assetId` 代理，浏览器始终见我方域名。
 * - 超星文件但未转存（顶层 objectId 或 url 指向超星/带 objectid 参数）：显示「获取」按钮，
 *   点击触发后端转存并回写，完成后用我方代理打开；绝不直接打开超星原始 url。
 * - 非超星第三方外链（如政府公示 pdf）：作为普通外链新开标签。
 */
export function AttachmentFileLink({
  file,
  business,
  recordId,
  field,
  onTransferred,
}: {
  file: BiddingFileRef | null | undefined;
  business: Business;
  recordId: string;
  field: string;
  onTransferred?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  if (!file) return <span className="text-muted-foreground">—</span>;

  const url = file.url || '';
  const hasAsset = !!file.assetId;
  const hasTopOid = /^[a-f0-9]{32}$/i.test(file.objectId || '');
  const isChaoxingUrl =
    /objectid=[a-f0-9]{32}/i.test(url) || /chaoxing\.com|cldisk\.com|chaoxing\.cn/i.test(url);
  // 非超星、无 objectId、但有外链地址 → 第三方原始链接
  const isExternalLink = !hasAsset && !hasTopOid && !isChaoxingUrl && !!url;
  const canAcquire = !hasAsset && (hasTopOid || isChaoxingUrl);
  const isFailed = file.storageStatus === 'failed';

  const href = hasAsset
    ? `/api/files/preview/${file.assetId}`
    : isExternalLink
      ? url
      : '#';

  const acquire = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch<TransferResult>('/api/files/transfer', {
        method: 'POST',
        body: JSON.stringify({
          business,
          recordId,
          field: business === 'qiming' ? undefined : field,
          objectId: file.objectId || undefined,
          url: file.url || undefined,
        }),
      });
      if (!res.ok) {
        showToast(res.error || '转存失败，请稍后重试', { kind: 'error' });
        return;
      }
      showToast(res.status === 'direct' ? '文件较大，已切换为我方代理直链' : '附件已转存，正在打开…', {
        kind: 'success',
      });
      onTransferred?.();
      if (res.assetId) window.open(`/api/files/preview/${res.assetId}`, '_blank', 'noopener,noreferrer');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '获取附件失败', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-background px-2 py-1.5">
      {hasAsset ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1.5 text-xs text-brand hover:underline"
        >
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="truncate">{file.name || '附件'}</span>
          {file.size ? <span className="shrink-0 text-muted-foreground">({file.size})</span> : null}
        </a>
      ) : isExternalLink ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-brand hover:underline"
          title="第三方原始链接"
        >
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="truncate">{file.name || '附件'}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ) : (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="h-3 w-3 shrink-0" />
          <span className="truncate">{file.name || '附件'}</span>
          {file.size ? <span className="shrink-0">({file.size})</span> : null}
        </span>
      )}

      {isFailed && hasAsset && (
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-60"
          onClick={acquire}
          disabled={busy}
        >
          <RefreshCw className={busy ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
          重试
        </button>
      )}
      {!hasAsset && canAcquire && (
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-brand hover:bg-muted disabled:opacity-60"
          onClick={acquire}
          disabled={busy}
          title="从超星拉取并转存到本系统后预览"
        >
          {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {busy ? '转存中…' : '获取'}
        </button>
      )}
    </div>
  );
}
