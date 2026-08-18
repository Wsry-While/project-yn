/**
 * Supabase Storage 文件上传工具。
 *
 * 从环境变量读取 bucket，按环境隔离（dev / prod 可使用不同 bucket）。
 * 使用 admin 客户端（service role）上传，文件默认私有，下载走签名 URL。
 */
import { randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '@/lib/supabase-client';

const DEFAULT_BUCKET = 'bidding-attachments';

export interface StorageUploadInput {
  /** 对象存储内的 key，例如 bidding-screenshots/{externalId}/{field}/{uuid}.docx */
  key: string;
  body: Blob | Buffer | ArrayBuffer | Uint8Array;
  contentType: string;
}

export interface StorageUploadResult {
  bucket: string;
  key: string;
  /** 公开访问 URL；私有 bucket 时为 /storage/v1/object/sign/{bucket}/{key}，需配合签名 */
  path: string;
}

function getBucket(): string {
  return process.env.STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;
}

/** 把 ReadableStream 完整读成 Uint8Array。 */
export async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** 上传文件到 Supabase Storage。 */
export async function uploadToStorage(input: StorageUploadInput): Promise<StorageUploadResult> {
  const bucket = getBucket();
  const db = getSupabaseAdminClient();
  const { error } = await db.storage.from(bucket).upload(input.key, input.body, {
    contentType: input.contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(`上传到 Supabase Storage 失败: ${error.message}`);
  }
  return { bucket, key: input.key, path: `${bucket}/${input.key}` };
}

/** 生成短期签名下载 URL（默认 10 分钟）。 */
export async function createSignedDownloadUrl(bucket: string, key: string, expiresInSec = 600): Promise<string> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db.storage.from(bucket).createSignedUrl(key, expiresInSec);
  if (error || !data) {
    throw new Error(`生成签名 URL 失败: ${error?.message ?? 'unknown'}`);
  }
  return data.signedUrl;
}

/** 构造对象 key：bidding-screenshots/{externalId}/{fieldAlias}/{uuid}.{suffix} */
export function buildAttachmentKey(params: {
  externalId: string;
  fieldAlias: string;
  suffix?: string | null;
}): string {
  const safeExternalId = params.externalId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeField = params.fieldAlias.replace(/[^a-zA-Z0-9_-]/g, '_');
  const suffix = (params.suffix || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
  return `bidding-screenshots/${safeExternalId}/${safeField}/${randomUUID()}.${suffix}`;
}
