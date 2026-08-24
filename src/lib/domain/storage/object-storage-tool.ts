/**
 * 扣子内置对象存储（S3 兼容）文件上传/签名工具。
 *
 * 存储凭证由 Coze 平台自动注入：
 * - COZE_BUCKET_ENDPOINT_URL：S3 endpoint / 签名服务地址
 * - COZE_BUCKET_NAME：默认桶名
 * 无需在项目内配置 accessKey / secretKey。
 *
 * 文件默认私有，访问通过 generatePresignedUrl 生成短期签名 URL；
 * 上层（asset-access）再以服务端流式代理方式回传，以统一中文文件名与 inline 预览。
 */
import { randomUUID } from 'node:crypto';
import { S3Storage } from 'coze-coding-dev-sdk';

let cachedStorage: S3Storage | null = null;

function getStorage(): S3Storage {
  if (!cachedStorage) {
    cachedStorage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: '',
      secretKey: '',
      bucketName: process.env.COZE_BUCKET_NAME,
      region: 'cn-beijing',
    });
  }
  return cachedStorage;
}

/** 当前生效的桶名（仅用于回写到 external_file_assets.bucket，便于排查）。 */
export function getStorageBucket(): string {
  return process.env.COZE_BUCKET_NAME?.trim() || 'coze-builtin';
}

export interface StorageUploadInput {
  /** 建议的对象 key（含目录前缀与文件名），用于生成可读的 fileName。 */
  key: string;
  body: Blob | Buffer | ArrayBuffer | Uint8Array;
  contentType: string;
}

export interface StorageUploadResult {
  bucket: string;
  /** SDK 实际生成的 key（含 UUID 前缀），后续访问必须用它，而不是传入的 key。 */
  key: string;
  path: string;
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

/** 上传文件到扣子内置对象存储。 */
export async function uploadToStorage(input: StorageUploadInput): Promise<StorageUploadResult> {
  const storage = getStorage();
  // S3Storage 以 fileName 为基础生成最终 key（含 UUID 前缀），这里传入带目录的
  // 语义化文件名，便于在存储后台按目录识别；最终 key 以返回值为准。
  let buffer: Buffer;
  if (Buffer.isBuffer(input.body)) {
    buffer = input.body;
  } else if (input.body instanceof Uint8Array) {
    buffer = Buffer.from(input.body.buffer, input.body.byteOffset, input.body.byteLength);
  } else if (input.body instanceof ArrayBuffer) {
    buffer = Buffer.from(input.body);
  } else {
    // Blob 分支：先取 ArrayBuffer 再转 Buffer
    const ab = await (input.body as Blob).arrayBuffer();
    buffer = Buffer.from(ab);
  }
  const key = await storage.uploadFile({
    fileContent: buffer,
    fileName: input.key,
    contentType: input.contentType,
  });
  const bucket = getStorageBucket();
  return { bucket, key, path: `${bucket}/${key}` };
}

/**
 * 生成短期签名 URL（默认 10 分钟）。
 *
 * 注意：内置 S3 签名服务不支持通过参数指定 Content-Disposition，因此 inline 预览
 * 与中文文件名下载统一由上层 streamAssetDownload 流式代理设置响应头，不直接依赖
 * 此 URL 的下载行为。options.download 仅为保持调用方接口兼容而保留。
 */
export async function createSignedDownloadUrl(
  _bucket: string,
  key: string,
  expiresInSec = 600,
  _options?: { download?: boolean | string },
): Promise<string> {
  const storage = getStorage();
  return storage.generatePresignedUrl({ key, expireTime: expiresInSec });
}

/** 删除对象（清理旧文件时使用）。 */
export async function deleteFromStorage(key: string, bucket?: string): Promise<boolean> {
  const storage = getStorage();
  return storage.deleteFile({ fileKey: key, bucket });
}

/** 构造建议的对象名：bidding-screenshots/{externalId}/{fieldAlias}/{uuid}.{suffix} */
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
