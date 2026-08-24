/**
 * 启明星建设附件转存服务。
 * 复用 external_file_assets 表 + 超星云盘下载工具 + 对象存储工具，
 * 与项目建设申请/招投标截图共享同一套 bucket 和签名 URL 机制。
 */
import { getSupabaseAdminClient } from '@/lib/supabase-client';
import { resolveAssetDownload, retryAssetTransfer } from './asset-access';
import type { BiddingFileRef, BiddingFileStorageStatus, QimingConstruction } from './types';
import {
  downloadChaoxingFile,
  getChaoxingDirectDownloadUrl,
  isStorageFileTooLargeError,
  ChaoxingFileError,
  assertValidObjectId,
  probeChaoxingFileSize,
  STORAGE_MAX_FILE_BYTES,
} from './chaoxing/file-tool';
import {
  buildAttachmentKey,
  createSignedDownloadUrl,
  streamToUint8Array,
  uploadToStorage,
} from './storage/object-storage-tool';

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

async function ensureAssetRow(file: BiddingFileRef, sourceUrl: string): Promise<AssetRow | null> {
  if (!file.objectId) return null;
  try {
    assertValidObjectId(file.objectId);
  } catch {
    return null;
  }
  const db = getSupabaseAdminClient();
  const { data: existing } = await db
    .from('external_file_assets')
    .select('*')
    .eq('source', 'chaoxing')
    .eq('object_id', file.objectId)
    .maybeSingle();
  if (existing) return existing as AssetRow;
  const now = new Date().toISOString();
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
    if (/duplicate|unique/i.test(error.message)) {
      const { data: raced } = await db
        .from('external_file_assets')
        .select('*')
        .eq('source', 'chaoxing')
        .eq('object_id', file.objectId)
        .maybeSingle();
      return (raced as AssetRow) ?? null;
    }
    return null;
  }
  return data as AssetRow;
}

async function markAssetStatus(id: string, patch: Partial<AssetRow>): Promise<void> {
  const db = getSupabaseAdminClient();
  await db.from('external_file_assets').update(patch).eq('id', id);
}

async function transferOne(asset: AssetRow, externalId: string, field: string): Promise<{ bucket: string; key: string }> {
  const objectId = asset.object_id;
  // 下载前预检，超大文件直接降级直链，避免缓冲进 Node 堆导致 OOM。
  const knownSize =
    typeof asset.byte_size === 'number' && asset.byte_size > 0 ? asset.byte_size : await probeChaoxingFileSize(objectId);
  if (knownSize && knownSize > STORAGE_MAX_FILE_BYTES) {
    throw new ChaoxingFileError(
      `文件超过对象存储单文件上限（约 ${Math.round(STORAGE_MAX_FILE_BYTES / 1024 / 1024)}MB，源文件 ${knownSize} 字节）`,
      'too_large',
    );
  }
  const result = await downloadChaoxingFile(objectId, { fallbackName: asset.file_name ?? undefined });
  const bytes = await streamToUint8Array(result.stream);
  const contentType = result.contentType || asset.content_type || 'application/octet-stream';
  const fileName = result.fileName || asset.file_name || asset.object_id;
  const suffix = asset.suffix || fileName.split('.').pop() || 'bin';
  const key = buildAttachmentKey({ externalId, fieldAlias: `qiming-${field}`, suffix });
  const upload = await uploadToStorage({ key, body: bytes, contentType });
  return { bucket: upload.bucket, key: upload.key };
}

export async function processQimingAttachments(record: QimingConstruction): Promise<void> {
  const attachments = (record.projectMaterials ?? [])
    .filter((f): f is BiddingFileRef => !!f && !!f.objectId)
    .map((f) => ({ field: 'materials', file: f }));
  if (attachments.length === 0) return;

  const assetByObjectId = new Map<string, AssetRow>();
  let nextFiles: BiddingFileRef[] = [...(record.projectMaterials ?? [])];
  const updateFile = (objectId: string, updater: (f: BiddingFileRef) => BiddingFileRef) => {
    nextFiles = nextFiles.map((f) => (f.objectId === objectId ? updater(f) : f));
  };

  for (const { file } of attachments) {
    if (!file.objectId) continue;
    const sourceUrl = file.url || `https://d0.cldisk.com/download/${file.objectId}`;
    const asset = await ensureAssetRow(file, sourceUrl);
    if (!asset) continue;
    assetByObjectId.set(file.objectId, asset);
    updateFile(file.objectId, (f) => ({
      ...f,
      assetId: asset.id,
      storageStatus: (f.storageStatus ?? 'pending') as BiddingFileStorageStatus,
    }));
  }
  const db = getSupabaseAdminClient();
  await db.from('qiming_construction').update({ project_materials: nextFiles }).eq('id', record.id);

  for (const { field, file } of attachments) {
    if (!file.objectId) continue;
    const asset = assetByObjectId.get(file.objectId);
    if (!asset) continue;
    if (asset.status === 'stored' && asset.bucket && asset.storage_key) {
      updateFile(file.objectId, (f) => ({
        ...f,
        assetId: asset.id,
        bucket: asset.bucket,
        storageKey: asset.storage_key,
        storageStatus: 'stored',
        storedAt: asset.fetched_at,
        storageError: null,
      }));
      continue;
    }
    await markAssetStatus(asset.id, { status: 'fetching' });
    try {
      const { bucket, key } = await transferOne(asset, record.externalId || record.id, field);
      await markAssetStatus(asset.id, {
        status: 'stored',
        bucket,
        storage_key: key,
        stored_url: `/${bucket}/${key}`,
        fetched_at: new Date().toISOString(),
        error_message: null,
      });
      updateFile(file.objectId, (f) => ({
        ...f,
        assetId: asset.id,
        bucket,
        storageKey: key,
        storageStatus: 'stored',
        storedAt: new Date().toISOString(),
        storageError: null,
      }));
    } catch (err) {
      const message = err instanceof ChaoxingFileError ? `${err.code}: ${err.message}` : (err as Error).message;
      if (isStorageFileTooLargeError(err) || (err instanceof ChaoxingFileError && err.code === 'too_large')) {
        const note = '超大文件，走超星直链下载';
        await markAssetStatus(asset.id, { status: 'direct', error_message: note, fetched_at: new Date().toISOString() });
        updateFile(file.objectId, (f) => ({ ...f, storageStatus: 'direct', storageError: note }));
        continue;
      }
      await markAssetStatus(asset.id, { status: 'failed', error_message: message, retry_count: asset.retry_count + 1 });
      updateFile(file.objectId, (f) => ({ ...f, storageStatus: 'failed', storageError: message }));
    }
  }

  await db.from('qiming_construction').update({ project_materials: nextFiles }).eq('id', record.id);
}

export async function getQimingAssetSignedUrl(assetId: string): Promise<{ signedUrl: string; fileName: string } | null> {
  const resolved = await resolveAssetDownload(assetId);
  if (!resolved) return null;
  return { signedUrl: resolved.signedUrl, fileName: resolved.fileName };
}

/** 重新转存一条启明星附件（失败/待处理时使用）。 */
export async function retryQimingAsset(assetId: string): Promise<{ ok: boolean; error?: string }> {
  const result = await retryAssetTransfer(assetId);
  return { ok: result.ok, error: result.error };
}
