/**
 * 附件资产统一访问层。
 *
 * external_file_assets 被招投标截图 / 项目建设申请 / 启明星建设三个业务共用，
 * 这里集中提供「查元数据 / 取下载地址 / 重试转存」能力，避免三个 service 各写一份。
 *
 * 状态机：pending -> fetching -> stored（对象存储）
 *                              -> direct（超大文件走超星直链）
 *                              -> failed（可重试）
 */
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import {
  buildAttachmentKey,
  createSignedDownloadUrl,
  streamToUint8Array,
  uploadToStorage,
} from './storage/object-storage-tool';
import {
  assertValidObjectId,
  ChaoxingFileError,
  downloadChaoxingFile,
  getChaoxingDirectDownloadUrl,
  isStorageFileTooLargeError,
  probeChaoxingFileSize,
  STORAGE_MAX_FILE_BYTES,
} from './chaoxing/file-tool';

export type AssetStatus = 'pending' | 'fetching' | 'stored' | 'failed' | 'direct';

export interface AssetMeta {
  id: string;
  source: string;
  objectId: string;
  fileName: string;
  suffix: string | null;
  contentType: string | null;
  byteSize: number | null;
  status: AssetStatus;
  errorMessage: string | null;
  retryCount: number;
  bucket: string | null;
  storageKey: string | null;
  storedUrl: string | null;
  fetchedAt: string | null;
  createdAt: string | null;
}

type AssetRow = Omit<AssetMeta, 'objectId' | 'fileName' | 'suffix' | 'contentType' | 'byteSize' | 'errorMessage' | 'retryCount' | 'storageKey' | 'storedUrl' | 'fetchedAt' | 'createdAt'> & {
  object_id: string;
  file_name: string | null;
  suffix: string | null;
  content_type: string | null;
  byte_size: number | null;
  error_message: string | null;
  retry_count: number;
  storage_key: string | null;
  stored_url: string | null;
  fetched_at: string | null;
  created_at: string | null;
};

function mapAsset(data: AssetRow): AssetMeta {
  return {
    id: data.id,
    source: data.source,
    objectId: data.object_id,
    fileName: data.file_name || data.object_id,
    suffix: data.suffix,
    contentType: data.content_type,
    byteSize: data.byte_size,
    status: data.status,
    errorMessage: data.error_message,
    retryCount: data.retry_count,
    bucket: data.bucket,
    storageKey: data.storage_key,
    storedUrl: data.stored_url,
    fetchedAt: data.fetched_at,
    createdAt: data.created_at,
  };
}

/** 根据文件名/MIME 推断适合浏览器在线预览的类型。 */
export function getPreviewKind(meta: AssetMeta): 'image' | 'pdf' | 'office' | 'video' | 'audio' | 'other' {
  const name = (meta.fileName || '').toLowerCase();
  const mime = (meta.contentType || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop()! : meta.suffix?.toLowerCase() || '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'office';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a'].includes(ext)) return 'audio';
  return 'other';
}

export async function getAssetMeta(assetId: string): Promise<AssetMeta | null> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db.from('external_file_assets').select('*').eq('id', assetId).maybeSingle();
  if (error || !data) return null;
  return mapAsset(data as AssetRow);
}

async function markAssetStatus(
  id: string,
  patch: Partial<Pick<AssetRow, 'status' | 'error_message' | 'bucket' | 'storage_key' | 'stored_url' | 'fetched_at' | 'retry_count'>>,
): Promise<void> {
  const db = getSupabaseAdminClient();
  const { error } = await db.from('external_file_assets').update(patch).eq('id', id);
  if (error) console.warn('[asset-access] markAssetStatus failed', { id, error: error.message });
}

/** 下载 + 上传单个 asset，返回对象存储位置。 */
async function transferAsset(asset: AssetMeta, externalId: string, field: string): Promise<{ bucket: string; key: string }> {
  // 下载前预检大小：超过对象存储上限直接降级，避免把大文件缓冲进 Node 堆导致 OOM。
  const knownSize =
    typeof asset.byteSize === 'number' && asset.byteSize > 0 ? asset.byteSize : await probeChaoxingFileSize(asset.objectId);
  if (knownSize && knownSize > STORAGE_MAX_FILE_BYTES) {
    throw new ChaoxingFileError(
      `文件超过对象存储单文件上限（约 ${Math.round(STORAGE_MAX_FILE_BYTES / 1024 / 1024)}MB，源文件 ${knownSize} 字节）`,
      'too_large',
    );
  }
  const result = await downloadChaoxingFile(asset.objectId, { fallbackName: asset.fileName ?? undefined });
  const bytes = await streamToUint8Array(result.stream);
  const contentType = result.contentType || asset.contentType || 'application/octet-stream';
  const fileName = result.fileName || asset.fileName || asset.objectId;
  const suffix = asset.suffix || fileName.split('.').pop() || 'bin';
  const key = buildAttachmentKey({ externalId, fieldAlias: field, suffix });
  const uploadResult = await uploadToStorage({ key, body: bytes, contentType });
  return { bucket: uploadResult.bucket, key: uploadResult.key };
}

export interface RetryResult {
  ok: boolean;
  status?: AssetStatus;
  assetId?: string;
  error?: string;
}

/**
 * 对一个 objectId 幂等建 asset 行（如尚未建）并执行一次转存。
 *
 * 用于历史附件「只有 objectId、没有 assetId」时的手动获取/重试：建完行后直接
 * 走 retryAssetTransfer 的下载/上传/降级流程。返回最终状态与 assetId，供调用方
 * 回写业务表 JSONB。
 */
export async function ensureAndTransferByObjectId(
  objectId: string,
  ctx: {
    externalId?: string;
    field?: string;
    fileName?: string | null;
    suffix?: string | null;
    contentType?: string | null;
    byteSize?: number | null;
  } = {},
): Promise<RetryResult> {
  const meta = await ensureAssetByObjectId(objectId, {
    fileName: ctx.fileName,
    suffix: ctx.suffix,
    contentType: ctx.contentType,
    byteSize: ctx.byteSize,
  });
  if (!meta) return { ok: false, error: '非法的 objectId 或建 asset 失败' };
  const result = await retryAssetTransfer(meta.id, {
    externalId: ctx.externalId,
    field: ctx.field,
  });
  return { ...result, assetId: meta.id };
}

/**
 * 重新转存一个失败/待处理的附件。
 * - 超过对象存储上限的降级为 direct（超星直链），算成功。
 * - 其余失败回写 failed 并返回错误信息。
 */
export async function retryAssetTransfer(
  assetId: string,
  ctx: { externalId?: string; field?: string } = {},
): Promise<RetryResult> {
  const meta = await getAssetMeta(assetId);
  if (!meta) return { ok: false, error: '附件不存在' };
  if (meta.status === 'stored' || meta.status === 'direct') return { ok: true, status: meta.status };
  if (meta.status === 'fetching') return { ok: false, status: 'fetching', error: '正在转存中，请稍后刷新' };

  await markAssetStatus(meta.id, { status: 'fetching', error_message: null });
  try {
    const { bucket, key } = await transferAsset(meta, ctx.externalId || meta.objectId, ctx.field || 'retry');
    await markAssetStatus(meta.id, {
      status: 'stored',
      bucket,
      storage_key: key,
      stored_url: `/${bucket}/${key}`,
      fetched_at: new Date().toISOString(),
      error_message: null,
    });
    return { ok: true, status: 'stored' };
  } catch (err) {
    const message = err instanceof Error ? err.message : '转存失败';
    if (isStorageFileTooLargeError(err) || (err instanceof ChaoxingFileError && err.code === 'too_large')) {
      await markAssetStatus(meta.id, {
        status: 'direct',
        error_message: '超大文件，走超星直链下载',
        fetched_at: new Date().toISOString(),
      });
      return { ok: true, status: 'direct' };
    }
    await markAssetStatus(meta.id, {
      status: 'failed',
      error_message: message,
      retry_count: meta.retryCount + 1,
    });
    return { ok: false, status: 'failed', error: message };
  }
}

/**
 * 解析附件下载地址。
 * - stored：对象存储短期签名 URL
 * - direct：实时换取超星直链（带临时签名）
 * 其余状态返回 null（前端应引导用户点「重新获取」）。
 */
export async function resolveAssetDownload(
  assetId: string,
): Promise<{ signedUrl: string; fileName: string; status: AssetStatus } | null> {
  const meta = await getAssetMeta(assetId);
  if (!meta) return null;
  if (meta.status === 'direct') {
    try {
      const direct = await getChaoxingDirectDownloadUrl(meta.objectId);
      return { signedUrl: direct.url, fileName: direct.fileName || meta.fileName, status: 'direct' };
    } catch {
      return null;
    }
  }
  if (meta.status !== 'stored' || !meta.bucket || !meta.storageKey) return null;
  const signedUrl = await createSignedDownloadUrl(meta.bucket, meta.storageKey, 10 * 60);
  return { signedUrl, fileName: meta.fileName || meta.storageKey.split('/').pop() || 'download', status: 'stored' };
}

/**
 * 直接按超星 objectId 实时换取临时签名直链（不经过 external_file_assets）。
 *
 * 用于历史数据里「只有 objectId、还没建 asset 行/没转存」的文件，让用户
 * 当下就能预览/下载，而不必先等待转存。签名现换现下、不可缓存。
 */
export async function resolveChaoxingDirectByObjectId(
  objectId: string,
): Promise<{ signedUrl: string; fileName: string | null }> {
  assertValidObjectId(objectId);
  const direct = await getChaoxingDirectDownloadUrl(objectId);
  return { signedUrl: direct.url, fileName: direct.fileName };
}

/**
 * 按 (source, objectId) 幂等查找或创建 asset 行。
 *
 * 历史附件可能尚未在 external_file_assets 建过记录，手动「获取/重试」时用它
 * 补齐 asset 行，再交给 retryAssetTransfer 走下载转存流程。
 */
export async function ensureAssetByObjectId(
  objectId: string,
  seed?: { fileName?: string | null; suffix?: string | null; contentType?: string | null; byteSize?: number | null },
): Promise<AssetMeta | null> {
  try {
    assertValidObjectId(objectId);
  } catch {
    return null;
  }
  const db = getSupabaseAdminClient();
  const { data: existing, error: selectError } = await db
    .from('external_file_assets')
    .select('*')
    .eq('source', 'chaoxing')
    .eq('object_id', objectId)
    .maybeSingle();
  if (selectError) {
    console.warn('[asset-access] ensureAssetByObjectId query failed', { objectId, error: selectError.message });
    return null;
  }
  if (existing) return mapAsset(existing as AssetRow);

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('external_file_assets')
    .insert({
      source: 'chaoxing',
      object_id: objectId,
      source_url: `https://d0.cldisk.com/download/${objectId}`,
      file_name: seed?.fileName ?? null,
      suffix: seed?.suffix ?? null,
      content_type: seed?.contentType ?? null,
      byte_size: seed?.byteSize ?? null,
      status: 'pending',
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      const { data: raced } = await db
        .from('external_file_assets')
        .select('*')
        .eq('source', 'chaoxing')
        .eq('object_id', objectId)
        .maybeSingle();
      return raced ? mapAsset(raced as AssetRow) : null;
    }
    console.warn('[asset-access] ensureAssetByObjectId insert failed', { objectId, error: error.message });
    return null;
  }
  return mapAsset(data as AssetRow);
}
