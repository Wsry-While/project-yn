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
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB
const FETCH_TIMEOUT_MS = 30_000;

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
    FETCH_TIMEOUT_MS,
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
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
      throw new ChaoxingFileError(`文件超过大小上限（${MAX_FILE_BYTES} 字节）`, 'too_large');
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
