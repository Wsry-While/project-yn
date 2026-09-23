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
import { resolveAssetDownload, retryAssetTransfer, ensureAndTransferByObjectId, getAssetMeta } from './asset-access';
import type { BiddingFileRef, BiddingFileStorageStatus, BiddingScreenshot } from './types';
import {
  downloadChaoxingFile,
  getChaoxingDirectDownloadUrl,
  isStorageFileTooLargeError,
  ChaoxingFileError,
  assertValidObjectId,
  probeChaoxingFileSize,
  resolveObjectId,
  STORAGE_MAX_FILE_BYTES,
} from './chaoxing/file-tool';
import {
  buildAttachmentKey,
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

/**
 * 归一化文件引用的 objectId：顶层有就用，否则从 url 的 objectid= 参数解析。
 * 返回一份带回填 objectId 的副本；实在拿不到合法 objectId 才返回 null。
 */
function withResolvedObjectId(file: BiddingFileRef): BiddingFileRef | null {
  const oid = resolveObjectId(file);
  if (!oid) return null;
  return oid === file.objectId ? file : { ...file, objectId: oid };
}

function collectAttachments(record: BiddingScreenshot): Array<{ field: AttachmentField; file: BiddingFileRef }> {
  const out: Array<{ field: AttachmentField; file: BiddingFileRef }> = [];
  for (const field of ATTACHMENT_FIELDS) {
    const value = record[field];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const f of value) {
        const resolved = f ? withResolvedObjectId(f) : null;
        if (resolved) out.push({ field, file: resolved });
      }
    } else {
      const resolved = withResolvedObjectId(value);
      if (resolved) out.push({ field, file: resolved });
    }
  }
  return out;
}

async function ensureAssetRow(file: BiddingFileRef, sourceUrl: string): Promise<AssetRow | null> {
  // 调用方（collectAttachments）已通过 resolveObjectId 保证 file.objectId 合法。
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
  // 下载前预检文件大小：超过对象存储上限直接降级，避免把大文件缓冲进 Node 堆导致 OOM。
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
    objectId: file.objectId,
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
    objectId: file.objectId,
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
    objectId: file.objectId,
    storageStatus: 'direct' satisfies BiddingFileStorageStatus,
    storageError: note,
  };
}

function applyPending(file: BiddingFileRef, assetId: string): BiddingFileRef {
  return {
    ...file,
    objectId: file.objectId,
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
  // 数据库列为蛇形，这里显式映射，避免把驼峰 key 直接传给 update 导致列不存在。
  const dbPatch: Record<string, unknown> = {};
  if (patch.projectBiddingFile !== undefined) dbPatch.project_bidding_file = patch.projectBiddingFile;
  if (patch.deliveryDocument !== undefined) dbPatch.delivery_document = patch.deliveryDocument;
  if (patch.attachments !== undefined) dbPatch.attachments = patch.attachments;
  if (patch.rectifiedDocument !== undefined) dbPatch.rectified_document = patch.rectifiedDocument;
  const { error } = await db.from('bidding_screenshots').update(dbPatch).eq('id', record.id);
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

  // 用归一化后的文件（含从 url 解析出的 objectId）定位 nextFiles 里的对应条目：
  // 原始推送可能顶层 objectId 为空，仅靠 objectId 匹配会漏掉这类文件，因此按
  // objectId → url → name 逐级匹配；回写时把解析出的 objectId 一并落库。
  const sameFile = (f: BiddingFileRef, resolved: BiddingFileRef): boolean =>
    (!!resolved.objectId && f.objectId === resolved.objectId) ||
    (!!resolved.url && f.url === resolved.url) ||
    (!resolved.url && !!f.name && f.name === resolved.name);

  const updateField = (
    field: AttachmentField,
    resolved: BiddingFileRef,
    updater: (f: BiddingFileRef) => BiddingFileRef,
  ) => {
    const inject = (f: BiddingFileRef): BiddingFileRef =>
      updater(resolved.objectId ? { ...f, objectId: resolved.objectId } : f);
    if (field === 'attachments') {
      nextFiles.attachments = nextFiles.attachments.map((f) => (sameFile(f, resolved) ? inject(f) : f));
      return;
    }
    const current = nextFiles[field];
    if (Array.isArray(current)) {
      nextFiles[field] = current.map((f) => (sameFile(f, resolved) ? inject(f) : f));
    }
  };

  for (const { field, file } of attachments) {
    const sourceUrl = file.url || `https://d0.cldisk.com/download/${file.objectId}`;
    const asset = await ensureAssetRow(file, sourceUrl);
    if (!asset || !file.objectId) continue;
    assetByObjectId.set(file.objectId, asset);
    updateField(field, file, (f) => applyPending(f, asset.id));
  }
  await persistBusinessRecord(record, nextFiles);

  // 2. 真正下载/转存
  for (const { field, file } of attachments) {
    if (!file.objectId) continue;
    const asset = assetByObjectId.get(file.objectId);
    if (!asset) continue;
    if (asset.status === 'stored' && asset.bucket && asset.storage_key) {
      updateField(field, file, (f) => applyStorageResult(f, asset.id, asset.bucket!, asset.storage_key!));
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
      updateField(field, file, (f) => applyStorageResult(f, asset.id, bucket, key));
      log('info', 'attachment transferred', { objectId: file.objectId, bucket, key });
    } catch (err) {
      const message = err instanceof ChaoxingFileError ? `${err.code}: ${err.message}` : (err as Error).message;
      if (isStorageFileTooLargeError(err) || (err instanceof ChaoxingFileError && err.code === 'too_large')) {
        // 下载成功但对象存储拒绝超大文件：降级为超星直链（仍建 asset，标记 direct，
        // 前端凭 assetId 走我方预览代理，由后端实时换签名流式转发）。
        const directNote = '超大文件，走超星直链下载';
        await markAssetStatus(asset.id, {
          status: 'direct',
          error_message: directNote,
          fetched_at: new Date().toISOString(),
        });
        updateField(field, file, (f) => applyDirectDownload({ ...f, assetId: asset.id }, directNote));
        log('info', 'attachment too large, fallback to direct download', { objectId: file.objectId });
        continue;
      }
      await markAssetStatus(asset.id, {
        status: 'failed',
        error_message: message,
        retry_count: asset.retry_count + 1,
      });
      updateField(field, file, (f) => applyStorageFailure({ ...f, assetId: asset.id }, message));
      log('warn', 'attachment transfer failed', { objectId: file.objectId, error: message });
    }
  }

  await persistBusinessRecord(record, nextFiles);
}

/** 供手动重试或定时任务用：对一个 asset 重新下载转存。 */
export async function retryAsset(assetId: string): Promise<{ ok: boolean; error?: string }> {
  const result = await retryAssetTransfer(assetId);
  return { ok: result.ok, error: result.error };
}

/**
 * 对某条招投标记录里指定字段、指定 objectId 的单个附件执行转存并回写业务表。
 *
 * 用于历史数据「只有 objectId、没建 asset/没回写」时，用户在前端点「获取」即可
 * 就地补齐：ensureAndTransferByObjectId 幂等建 asset + 下载转存（超大文件降级 direct），
 * 这里把最终 assetId/status 回写到 bidding_screenshots 对应 JSONB 字段。
 */
export async function retransferBiddingFile(
  record: BiddingScreenshot,
  field: AttachmentField,
  objectId: string,
  fileUrl?: string | null,
): Promise<{ ok: boolean; status?: string; assetId?: string; error?: string }> {
  const matches = (f: BiddingFileRef | null | undefined): f is BiddingFileRef => {
    if (!f) return false;
    if (f.objectId && f.objectId === objectId) return true;
    // 顶层 objectId 为空时，按 url（含解析出 objectid 的超星链接）兜底定位
    if (fileUrl && f.url && f.url === fileUrl) return true;
    return false;
  };
  const list = field === 'attachments' ? record.attachments ?? [] : record[field] ?? [];
  const current = list.find(matches) ?? null;
  const result = await ensureAndTransferByObjectId(objectId, {
    externalId: record.externalId || record.id,
    field,
    fileName: current?.name,
    suffix: current?.suffix,
    contentType: current?.type,
    byteSize: current?.byteSize,
  });
  if (!result.assetId) return { ok: false, error: result.error };

  const patch: Partial<Pick<BiddingScreenshot, (typeof ATTACHMENT_FIELDS)[number]>> = {};
  const applyTo = async (f: BiddingFileRef): Promise<BiddingFileRef> => {
    // 回写时把从 url 解析出的 objectId 一并落库，后续即可按 objectId 正常关联。
    const base: BiddingFileRef = { ...f, objectId: f.objectId || objectId, assetId: result.assetId! };
    if (result.status === 'direct') {
      return applyDirectDownload(base, result.error ?? '超大文件，走超星直链下载');
    }
    if (!result.ok) {
      return applyStorageFailure(base, result.error ?? '转存失败');
    }
    // 成功转存：从 asset 行读取 bucket/key 回写，保证与对象存储一致。
    const meta = result.assetId ? await getAssetMeta(result.assetId) : null;
    return applyStorageResult(base, result.assetId!, meta?.bucket ?? '', meta?.storageKey ?? '');
  };

  const sourceList = field === 'attachments' ? record.attachments ?? [] : record[field] ?? [];
  patch[field] = await Promise.all(
    sourceList.map((f) => (matches(f) ? applyTo(f) : Promise.resolve(f))),
  );
  await persistBusinessRecord(record, patch);
  return { ok: result.ok, status: result.status, assetId: result.assetId, error: result.error };
}

/**
 * 解析附件下载地址（委托给统一访问层）。
 * - stored：返回对象存储的短期签名 URL
 * - direct：实时换取超星直链（带临时签名），供 307 跳转
 * 其余状态返回 null。
 */
export async function getAssetSignedUrl(assetId: string): Promise<{ signedUrl: string; fileName: string } | null> {
  const resolved = await resolveAssetDownload(assetId);
  if (!resolved) return null;
  return { signedUrl: resolved.signedUrl, fileName: resolved.fileName };
}
