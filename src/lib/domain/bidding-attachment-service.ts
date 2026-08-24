/**
 * 招投标截图附件转存服务。
 *
 * 流程：
 * 1. 从 bidding_screenshots 记录里提取所有带 objectId 的附件
 * 2. 以 objectId 为幂等键 upsert external_file_assets（status=pending）
 * 3. 异步下载超星文件 + 上传 Supabase Storage
 * 4. 回写 asset 表和业务表附件字段的 storage 状态
 *
 * 同一 objectId 在多条记录/多个字段里复用同一份 asset，只下载/上传一次。
 */
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import type { BiddingFileRef, BiddingFileStorageStatus, BiddingScreenshot } from './types';
import {
  downloadChaoxingFile,
  getChaoxingDirectDownloadUrl,
  isStorageFileTooLargeError,
  ChaoxingFileError,
  assertValidObjectId,
} from './chaoxing/file-tool';
import {
  buildAttachmentKey,
  createSignedDownloadUrl,
  streamToUint8Array,
  uploadToStorage,
} from './storage/object-storage-tool';

const ATTACHMENT_FIELDS = [
  'projectBiddingFile',
  'deliveryDocument',
  'attachments',
  'rectifiedDocument',
] as const;
type AttachmentField = (typeof ATTACHMENT_FIELDS)[number];

type AssetRow = {
  id: string;
  source: string;
  object_id: string;
  source_url: string | null;
  file_name: string | null;
  suffix: string | null;
  content_type: string | null;
  byte_size: number | null;
  bucket: string | null;
  storage_key: string | null;
  stored_url: string | null;
  status: 'pending' | 'fetching' | 'stored' | 'failed' | 'direct';
  error_message: string | null;
  retry_count: number;
  fetched_at: string | null;
};

const SERVICE_NAME = 'BiddingAttachmentService';

function log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>): void {
  const line = { service: SERVICE_NAME, level, message, ...(extra ?? {}) };
  if (level === 'error') console.error(JSON.stringify(line));
  else if (level === 'warn') console.warn(JSON.stringify(line));
  else console.log(JSON.stringify(line));
}

function collectAttachments(record: BiddingScreenshot): Array<{ field: AttachmentField; file: BiddingFileRef }> {
  const out: Array<{ field: AttachmentField; file: BiddingFileRef }> = [];
  for (const field of ATTACHMENT_FIELDS) {
    const value = record[field];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const file of value) {
        if (file?.objectId) out.push({ field, file });
      }
    } else if (value.objectId) {
      out.push({ field, file: value });
    }
  }
  return out;
}

async function ensureAssetRow(file: BiddingFileRef, sourceUrl: string): Promise<AssetRow | null> {
  if (!file.objectId) return null;
  try {
    assertValidObjectId(file.objectId);
  } catch {
    return null;
  }
  const db = getSupabaseAdminClient();
  const now = new Date().toISOString();
  // 已存在（含 stored/failed）则保留原状态，只刷新元数据；新建才落 pending
  const { data: existing, error: selectError } = await db
    .from('external_file_assets')
    .select('*')
    .eq('source', 'chaoxing')
    .eq('object_id', file.objectId)
    .maybeSingle();
  if (selectError) {
    log('error', 'query external_file_assets failed', { objectId: file.objectId, error: selectError.message });
    return null;
  }
  if (existing) return existing as AssetRow;

  const { data, error } = await db
    .from('external_file_assets')
    .insert({
      source: 'chaoxing',
      object_id: file.objectId,
      source_url: sourceUrl,
      file_name: file.name,
      suffix: file.suffix ?? null,
      content_type: file.type ?? null,
      byte_size: file.byteSize ?? null,
      status: 'pending',
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error) {
    // 并发情况下被其他请求抢先插入，回查一次
    if (/duplicate|unique/i.test(error.message)) {
      const { data: raced } = await db
        .from('external_file_assets')
        .select('*')
        .eq('source', 'chaoxing')
        .eq('object_id', file.objectId)
        .maybeSingle();
      return (raced as AssetRow) ?? null;
    }
    log('error', 'insert external_file_assets failed', { objectId: file.objectId, error: error.message });
    return null;
  }
  return data as AssetRow;
}

async function markAssetStatus(
  id: string,
  patch: Partial<
    Pick<
      AssetRow,
      | 'status'
      | 'error_message'
      | 'bucket'
      | 'storage_key'
      | 'stored_url'
      | 'file_name'
      | 'content_type'
      | 'byte_size'
      | 'fetched_at'
      | 'retry_count'
    >
  >,
): Promise<void> {
  const db = getSupabaseAdminClient();
  const { error } = await db.from('external_file_assets').update(patch).eq('id', id);
  if (error) log('warn', 'markAssetStatus update failed', { id, error: error.message });
}

/** 下载 + 上传，返回存储结果。 */
async function transferOne(asset: AssetRow, externalId: string, field: string): Promise<{ bucket: string; key: string }> {
  const objectId = asset.object_id;
  const result = await downloadChaoxingFile(objectId, { fallbackName: asset.file_name ?? undefined });
  const bytes = await streamToUint8Array(result.stream);
  const contentType = result.contentType || asset.content_type || 'application/octet-stream';
  const fileName = result.fileName || asset.file_name || objectId;
  const suffix = asset.suffix || fileName.split('.').pop() || 'bin';
  const key = buildAttachmentKey({ externalId, fieldAlias: field, suffix });
  const uploadResult = await uploadToStorage({
    key,
    body: bytes,
    contentType,
  });
  return { bucket: uploadResult.bucket, key: uploadResult.key };
}

/** 把转存结果合并进附件对象，供后续 update business 表使用。 */
function applyStorageResult(file: BiddingFileRef, assetId: string, bucket: string, key: string): BiddingFileRef {
  return {
    ...file,
    assetId,
    bucket,
    storageKey: key,
    storageStatus: 'stored' satisfies BiddingFileStorageStatus,
    storedAt: new Date().toISOString(),
    storageError: null,
  };
}

function applyStorageFailure(file: BiddingFileRef, errorMessage: string): BiddingFileRef {
  return {
    ...file,
    storageStatus: 'failed',
    storageError: errorMessage,
  };
}

/**
 * 超大文件无法转存对象存储时降级为「超星直链」：
 * 记录已验证可下载，用户点击时由后端实时换取新鲜签名 URL 后 307 跳转。
 */
function applyDirectDownload(file: BiddingFileRef, note: string): BiddingFileRef {
  return {
    ...file,
    storageStatus: 'direct' satisfies BiddingFileStorageStatus,
    storageError: note,
  };
}

function applyPending(file: BiddingFileRef, assetId: string): BiddingFileRef {
  return {
    ...file,
    assetId,
    storageStatus: file.storageStatus ?? 'pending',
  };
}

async function persistBusinessRecord(
  record: BiddingScreenshot,
  patch: Partial<
    Pick<
      BiddingScreenshot,
      'projectBiddingFile' | 'deliveryDocument' | 'attachments' | 'rectifiedDocument'
    >
  >,
): Promise<void> {
  const db = getSupabaseAdminClient();
  const { error } = await db.from('bidding_screenshots').update(patch).eq('id', record.id);
  if (error) log('warn', 'persistBusinessRecord failed', { id: record.id, error: error.message });
}

/**
 * 处理一条招投标截图记录的所有附件。
 *
 * - 先给每个附件建 asset 行，并把业务记录里的附件标记 pending
 * - 再逐个下载转存，已 stored 的 asset 直接复用
 * - 失败会标记 failed，但不抛出（避免阻塞其他附件）
 */
export async function processBiddingAttachments(record: BiddingScreenshot): Promise<void> {
  const attachments = collectAttachments(record);
  if (attachments.length === 0) return;

  // 1. 为每个 objectId 建 asset 行，并在业务记录里标记 pending
  const assetByObjectId = new Map<string, AssetRow>();
  const nextFiles: {
    projectBiddingFile: BiddingScreenshot['projectBiddingFile'];
    deliveryDocument: BiddingScreenshot['deliveryDocument'];
    attachments: BiddingScreenshot['attachments'];
    rectifiedDocument: BiddingScreenshot['rectifiedDocument'];
  } = {
    projectBiddingFile: record.projectBiddingFile,
    deliveryDocument: record.deliveryDocument,
    attachments: record.attachments ? [...record.attachments] : [],
    rectifiedDocument: record.rectifiedDocument,
  };

  const updateField = (field: AttachmentField, objectId: string, updater: (f: BiddingFileRef) => BiddingFileRef) => {
    if (field === 'attachments') {
      nextFiles.attachments = nextFiles.attachments.map((f) => (f.objectId === objectId ? updater(f) : f));
      return;
    }
    const current = nextFiles[field];
    if (current && !Array.isArray(current) && current.objectId === objectId) {
      nextFiles[field] = updater(current);
    }
  };

  for (const { field, file } of attachments) {
    const sourceUrl = file.url || `https://d0.cldisk.com/download/${file.objectId}`;
    const asset = await ensureAssetRow(file, sourceUrl);
    if (!asset || !file.objectId) continue;
    assetByObjectId.set(file.objectId, asset);
    updateField(field, file.objectId, (f) => applyPending(f, asset.id));
  }
  await persistBusinessRecord(record, nextFiles);

  // 2. 真正下载/转存
  for (const { field, file } of attachments) {
    if (!file.objectId) continue;
    const asset = assetByObjectId.get(file.objectId);
    if (!asset) continue;
    if (asset.status === 'stored' && asset.bucket && asset.storage_key) {
      updateField(field, file.objectId, (f) => applyStorageResult(f, asset.id, asset.bucket!, asset.storage_key!));
      continue;
    }

    await markAssetStatus(asset.id, { status: 'fetching' });
    try {
      const externalId = record.externalId || record.id;
      const { bucket, key } = await transferOne(asset, externalId, field);
      await markAssetStatus(asset.id, {
        status: 'stored',
        bucket,
        storage_key: key,
        stored_url: `/${bucket}/${key}`,
        fetched_at: new Date().toISOString(),
        error_message: null,
      });
      updateField(field, file.objectId, (f) => applyStorageResult(f, asset.id, bucket, key));
      log('info', 'attachment transferred', { objectId: file.objectId, bucket, key });
    } catch (err) {
      const message = err instanceof ChaoxingFileError ? `${err.code}: ${err.message}` : (err as Error).message;
      if (isStorageFileTooLargeError(err)) {
        // 下载成功但对象存储拒绝超大文件：降级为超星直链
        const directNote = '超大文件，走超星直链下载';
        await markAssetStatus(asset.id, {
          status: 'direct',
          error_message: directNote,
          fetched_at: new Date().toISOString(),
        });
        updateField(field, file.objectId, (f) => applyDirectDownload(f, directNote));
        log('info', 'attachment too large, fallback to direct download', { objectId: file.objectId });
        continue;
      }
      await markAssetStatus(asset.id, {
        status: 'failed',
        error_message: message,
        retry_count: asset.retry_count + 1,
      });
      updateField(field, file.objectId, (f) => applyStorageFailure(f, message));
      log('warn', 'attachment transfer failed', { objectId: file.objectId, error: message });
    }
  }

  await persistBusinessRecord(record, nextFiles);
}

/** 供手动重试或定时任务用：对一个 asset 重新下载转存。 */
export async function retryAsset(assetId: string): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db.from('external_file_assets').select('*').eq('id', assetId).single();
  if (error || !data) return { ok: false, error: error?.message ?? 'asset not found' };
  const asset = data as AssetRow;
  await markAssetStatus(asset.id, { status: 'fetching', error_message: null });
  try {
    const { bucket, key } = await transferOne(asset, 'retry', 'retry');
    await markAssetStatus(asset.id, {
      status: 'stored',
      bucket,
      storage_key: key,
      stored_url: `/${bucket}/${key}`,
      fetched_at: new Date().toISOString(),
      error_message: null,
    });
    return { ok: true };
  } catch (err) {
    const message = (err as Error).message;
    if (isStorageFileTooLargeError(err)) {
      await markAssetStatus(asset.id, {
        status: 'direct',
        error_message: '超大文件，走超星直链下载',
        fetched_at: new Date().toISOString(),
      });
      return { ok: true };
    }
    await markAssetStatus(asset.id, {
      status: 'failed',
      error_message: message,
      retry_count: asset.retry_count + 1,
    });
    return { ok: false, error: message };
  }
}

/**
 * 解析附件下载地址。
 * - stored：返回对象存储的短期签名 URL
 * - direct：实时换取超星直链（带临时签名），供 307 跳转
 * 其余状态返回 null。
 */
export async function getAssetSignedUrl(assetId: string): Promise<{ signedUrl: string; fileName: string } | null> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db.from('external_file_assets').select('*').eq('id', assetId).single();
  if (error || !data) return null;
  const asset = data as AssetRow;

  if (asset.status === 'direct' && asset.object_id) {
    try {
      const direct = await getChaoxingDirectDownloadUrl(asset.object_id);
      return {
        signedUrl: direct.url,
        fileName: direct.fileName || asset.file_name || 'download',
      };
    } catch {
      return null;
    }
  }

  if (asset.status !== 'stored' || !asset.bucket || !asset.storage_key) return null;
  const signedUrl = await createSignedDownloadUrl(asset.bucket, asset.storage_key, 10 * 60);
  return { signedUrl, fileName: asset.file_name || asset.storage_key.split('/').pop() || 'download' };
}
