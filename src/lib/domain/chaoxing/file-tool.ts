/**
 * 超星云盘文件下载工具。
 *
 * 实测有效的下载流程（2026-01 联调确认）：
 * 1. 先请求状态接口 `https://mooc1.chaoxing.com/ananas/status/{objectId}`，
 *    该接口匿名即可访问，返回的 `download` 字段是一个带临时签名
 *    （at_/ak_/ad_，at_ 为毫秒级过期时间戳）的真实下载地址。
 * 2. 再请求这个签名地址下载文件流。
 *
 * 关键点：
 * - 直接访问裸地址 `https://d0.cldisk.com/download/{objectId}` 会被 CDN 边缘 403
 *   （与来源 IP 是否在白名单无关，缺少签名 + 正确来源头即被拒）。
 * - 签名必须「现换现下」，不可缓存（at_ 很快过期）。
 * - User-Agent 使用标准浏览器 UA（对方白名单内）；Referer 固定为
 *   `https://office.chaoxing.com/`，匿名状态接口与下载均放行。
 * - 签名地址可能是 http://（超星要求「跳转地址协议与当前页一致」），
 *   服务端下载不存在浏览器混合内容限制，直接使用即可。
 */

/** 标准浏览器 UA，命中超星 CDN 的 UA 白名单。 */
export const CHAOXING_FILE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0';

const STATUS_BASE = 'https://mooc1.chaoxing.com/ananas/status';
const DOWNLOAD_REFERER = 'https://office.chaoxing.com/';
const OBJECT_ID_RE = /^[a-f0-9]{32}$/i;
/**
 * 单个附件下载大小上限（字节）。默认 250MB，可由环境变量
 * `CHAOXING_MAX_FILE_MB` 覆盖（已观测到 195MB 的源文件，100MB 旧上限会误拦）。
 */
export const MAX_FILE_BYTES = (Number(process.env.CHAOXING_MAX_FILE_MB) || 250) * 1024 * 1024;
/**
 * 对象存储单文件转存上限（保守值）。超过该大小会在下载前预检命中后直接降级为
 * 「超星直链」实时签名下载，避免把超大文件缓冲进 Node 堆导致 OOM。
 * 切到扣子内置对象存储后单文件上限较高，默认 256MB；可由 `STORAGE_MAX_FILE_MB`
 * 覆盖（设置更小会更早降级为直链，设置更大需同时确认平台实际上传限额）。
 */
export const STORAGE_MAX_FILE_BYTES =
  (Number(process.env.STORAGE_MAX_FILE_MB) || 256) * 1024 * 1024;
/** 状态接口（轻量 JSON）超时。 */
const STATUS_TIMEOUT_MS = 30_000;
/** 文件下载超时：大文件（百 MB 级）需要更长的总时长。 */
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface ChaoxingDownloadResult {
  stream: ReadableStream<Uint8Array>;
  fileName: string | null;
  contentType: string | null;
  byteSize: number | null;
  objectId: string;
}

export class ChaoxingFileError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'forbidden'
      | 'not_found'
      | 'upstream_error'
      | 'invalid_object_id'
      | 'timeout'
      | 'too_large'
      | 'unknown',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ChaoxingFileError';
  }
}

/** 校验 objectId 格式（32 位 hex），防止 SSRF。 */
export function assertValidObjectId(objectId: string): void {
  if (!OBJECT_ID_RE.test(objectId)) {
    throw new ChaoxingFileError(`非法的 objectId: ${String(objectId).slice(0, 64)}`, 'invalid_object_id');
  }
}

/**
 * 从超星文件 URL 中解析 32 位 objectId。
 *
 * 部分 fileupload 推送顶层 `objectId` 为空，真正的 id 藏在 url 的 query 里
 * （如 `https://office.chaoxing.com/front/open/data/export/download?objectid=<32hex>&…`）。
 * 先查 objectid/objectId 参数，再回退整串匹配，命中 32 位 hex 才返回，否则 null。
 */
export function extractObjectIdFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, 'http://x');
    const q = u.searchParams.get('objectid') || u.searchParams.get('objectId');
    if (q && OBJECT_ID_RE.test(q)) return q.toLowerCase();
  } catch {
    // 不是合法 URL，走下面的整串匹配
  }
  const m = url.match(/([a-f0-9]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * 归一化超星文件引用的 objectId：顶层有就用，否则尝试从 url 解析。
 * 返回合法的 32 位 objectId，拿不到返回 null。
 */
export function resolveObjectId(file: { objectId?: string | null; url?: string | null }): string | null {
  if (file.objectId && OBJECT_ID_RE.test(file.objectId)) return file.objectId.toLowerCase();
  return extractObjectIdFromUrl(file.url);
}

/** 从 Content-Disposition 解析文件名。 */
function parseFileName(contentDisposition: string | null, fallback: string | null): string | null {
  if (!contentDisposition) return fallback;
  // filename*=UTF-8''xxx
  const starMatch = /filename\*\s*=\s*([^;]+)/i.exec(contentDisposition);
  if (starMatch) {
    try {
      const [encoding, rawName] = starMatch[1].trim().split("''");
      if (encoding && rawName) return decodeURIComponent(rawName);
    } catch {
      // fall through
    }
  }
  const plainMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(contentDisposition);
  if (plainMatch) return plainMatch[1].trim();
  return fallback;
}

/** 用 AbortSignal 包装一个可超时的 fetch。 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 若外部已传入 signal，串联中止
    const parentSignal = init.signal;
    parentSignal?.addEventListener?.('abort', () => controller.abort(), { once: true });
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ChaoxingFileError('请求超星服务超时', 'timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface AnanasStatusResponse {
  download?: string;
  filename?: string;
  pdf?: string;
  crc?: string;
}

/**
 * 调用超星状态接口，为 objectId 换取带临时签名的真实下载地址。
 *
 * 该接口匿名可访问，无需登录 Cookie。
 */
async function resolveSignedDownloadUrl(objectId: string): Promise<{ url: string; fileName: string | null }> {
  const statusUrl = `${STATUS_BASE}/${objectId}`;
  const response = await fetchWithTimeout(
    statusUrl,
    {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent': CHAOXING_FILE_UA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': DOWNLOAD_REFERER,
      },
    },
    STATUS_TIMEOUT_MS,
  );

  if (response.status === 403) {
    throw new ChaoxingFileError(
      `超星状态接口拒绝访问（UA 白名单未生效），objectId=${objectId}`,
      'forbidden',
      403,
    );
  }
  if (response.status === 404) {
    throw new ChaoxingFileError('超星文件不存在或已删除', 'not_found', 404);
  }
  if (!response.ok) {
    throw new ChaoxingFileError(`超星状态接口返回 ${response.status}`, 'upstream_error', response.status);
  }

  let payload: AnanasStatusResponse;
  try {
    payload = (await response.json()) as AnanasStatusResponse;
  } catch (err) {
    throw new ChaoxingFileError(`超星状态接口返回非 JSON: ${(err as Error).message}`, 'upstream_error');
  }

  const downloadUrl = payload.download?.trim();
  if (!downloadUrl) {
    throw new ChaoxingFileError('超星状态接口未返回 download 地址', 'not_found');
  }

  let parsed: URL;
  try {
    parsed = new URL(downloadUrl);
  } catch {
    throw new ChaoxingFileError('超星返回的下载地址非法', 'upstream_error');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ChaoxingFileError(`非法的下载协议: ${parsed.protocol}`, 'upstream_error');
  }

  return { url: parsed.toString(), fileName: payload.filename?.trim() || null };
}

/**
 * 为 objectId 实时换取超星直链（带 at_/ak_/ad_ 临时签名）。
 *
 * 用于无法转存到对象存储的超大文件降级：用户点击时由服务端现换现跳，
 * 浏览器携带我方域名 Referer 直连超星 CDN 下载（我方域名已在对方白名单）。
 * 签名短时有效，不可缓存，必须每次请求重新换取。
 */
export async function getChaoxingDirectDownloadUrl(
  objectId: string,
): Promise<{ url: string; fileName: string | null }> {
  assertValidObjectId(objectId);
  return resolveSignedDownloadUrl(objectId);
}

/** 判断一个错误是否为「对象存储单文件超过上限」。 */
export function isStorageFileTooLargeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /maximum allowed single file size|file size.*exceed|payload too large|413/i.test(err.message);
}

/**
 * 对超星文件做一次 HEAD 式预检（实际用 GET 拿到响应头后立即取消 body），
 * 返回 Content-Length。用于在下载缓冲前判断文件是否超过对象存储上限，
 * 命中则直接降级直链，避免把大文件读进 Node 堆导致 OOM。
 *
 * 失败时返回 null（不阻断流程，交由下载阶段的 content-length 二次校验）。
 */
export async function probeChaoxingFileSize(objectId: string): Promise<number | null> {
  assertValidObjectId(objectId);
  let signedUrl: string;
  try {
    signedUrl = (await resolveSignedDownloadUrl(objectId)).url;
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(signedUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': CHAOXING_FILE_UA,
        'Accept': '*/*',
        'Referer': DOWNLOAD_REFERER,
        Range: 'bytes=0-0',
      },
    });
    // 手动跟随 3xx
    let redirectCount = 0;
    let resp = response;
    while (resp.status >= 300 && resp.status < 400) {
      if (redirectCount >= 5) return null;
      const location = resp.headers.get('location');
      resp.body?.cancel().catch(() => {});
      if (!location) return null;
      const nextUrl = new URL(location, signedUrl);
      if (nextUrl.protocol !== 'https:' && nextUrl.protocol !== 'http:') return null;
      signedUrl = nextUrl.toString();
      resp = await fetch(signedUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': CHAOXING_FILE_UA,
          'Accept': '*/*',
          'Referer': DOWNLOAD_REFERER,
          Range: 'bytes=0-0',
        },
      });
      redirectCount++;
    }
    const len = Number(resp.headers.get('content-length') ?? 'NaN');
    const range = resp.headers.get('content-range');
    resp.body?.cancel().catch(() => {});
    if (Number.isFinite(len) && len > 1) return len;
    // 分片响应：content-range: bytes 0-0/12345
    if (range) {
      const total = Number(range.split('/').pop() ?? 'NaN');
      if (Number.isFinite(total)) return total;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从超星云盘下载文件，返回可读流。
 *
 * 流程：先换签名地址 → 再下载；使用 AbortController 控制总超时；
 * 手动跟随 3xx，确保每一跳 Referer 一致。
 */
export async function downloadChaoxingFile(
  objectId: string,
  opts: { fallbackName?: string } = {},
): Promise<ChaoxingDownloadResult> {
  assertValidObjectId(objectId);

  const { url: signedUrl, fileName: signedName } = await resolveSignedDownloadUrl(objectId);

  const buildHeaders = (): Record<string, string> => ({
    'User-Agent': CHAOXING_FILE_UA,
    'Accept': '*/*',
    'Referer': DOWNLOAD_REFERER,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(signedUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: buildHeaders(),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ChaoxingFileError('下载超星文件超时', 'timeout');
    }
    if (err instanceof ChaoxingFileError) throw err;
    throw new ChaoxingFileError(`下载超星文件失败: ${(err as Error).message}`, 'unknown');
  }

  try {
    // 手动跟随 3xx，确保每一跳 Referer 一致
    let redirectCount = 0;
    while (response.status >= 300 && response.status < 400) {
      if (redirectCount >= 5) {
        throw new ChaoxingFileError('超星文件下载重定向次数过多', 'unknown');
      }
      const location = response.headers.get('location');
      if (!location) break;
      response.body?.cancel().catch(() => {});
      const nextUrl = new URL(location, signedUrl);
      if (nextUrl.protocol !== 'https:' && nextUrl.protocol !== 'http:') {
        throw new ChaoxingFileError(`非法的重定向地址: ${nextUrl.protocol}`, 'unknown');
      }
      response = await fetch(nextUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: buildHeaders(),
      });
      redirectCount++;
    }

    if (response.status === 403) {
      throw new ChaoxingFileError(
        '超星防盗链校验失败（签名地址已过期或来源未放行），请重新换取签名地址',
        'forbidden',
        403,
      );
    }
    if (response.status === 404) {
      throw new ChaoxingFileError('超星文件不存在或已删除', 'not_found', 404);
    }
    if (!response.ok) {
      throw new ChaoxingFileError(`超星文件服务返回 ${response.status}`, 'upstream_error', response.status);
    }
    if (!response.body) {
      throw new ChaoxingFileError('超星返回为空', 'unknown');
    }

    const contentLength = Number(response.headers.get('content-length') ?? 'NaN');
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES) {
      response.body.cancel().catch(() => {});
      const limitMb = Math.round(MAX_FILE_BYTES / 1024 / 1024);
      throw new ChaoxingFileError(
        `文件超过大小上限（${limitMb}MB，源文件 ${contentLength} 字节）`,
        'too_large',
      );
    }

    const fileName =
      signedName ||
      parseFileName(response.headers.get('content-disposition'), opts.fallbackName ?? null);
    const contentType = response.headers.get('content-type');

    const rawStream = response.body;
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        const reader = rawStream.getReader();
        const pump = async (): Promise<void> => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                clearTimeout(timer);
                streamController.close();
                return;
              }
              streamController.enqueue(value);
            }
          } catch (err) {
            clearTimeout(timer);
            streamController.error(err);
          }
        };
        void pump();
      },
      cancel(reason) {
        clearTimeout(timer);
        rawStream.cancel(reason).catch(() => {});
      },
    });

    return {
      stream,
      fileName,
      contentType,
      byteSize: Number.isFinite(contentLength) ? contentLength : null,
      objectId,
    };
  } catch (err) {
    clearTimeout(timer);
    response.body?.cancel().catch(() => {});
    throw err;
  }
}
