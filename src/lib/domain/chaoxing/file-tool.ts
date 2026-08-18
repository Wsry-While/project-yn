/**
 * 超星云盘文件下载工具。
 *
 * 规则（由超星运维确认）：
 * - 下载地址：https://d0.cldisk.com/download/{objectId}
 * - 通过 UA 白名单防盗链，User-Agent 固定为 CHAOXING_FILE_UA
 * - Referer 必须为空（不能带任何来源）
 * - 不依赖 at_/ak_/ad_ 等临时签名参数
 */

export const CHAOXING_FILE_UA = 'ProjectCenter-ChaoXing-FileProxy/1.0';
const CHAOXING_HOST = 'd0.cldisk.com';
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
    readonly code: 'forbidden' | 'not_found' | 'upstream_error' | 'invalid_object_id' | 'timeout' | 'too_large' | 'unknown',
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

/**
 * 从超星云盘下载文件，返回可读流。
 *
 * 关键：显式把 Referer 设为空字符串，避免某些运行时/代理注入；
 * 使用 AbortController 控制超时；手动跟随重定向（确保重定向后 Referer 仍为空）。
 */
export async function downloadChaoxingFile(
  objectId: string,
  opts: { fallbackName?: string } = {},
): Promise<ChaoxingDownloadResult> {
  assertValidObjectId(objectId);

  const url = `https://${CHAOXING_HOST}/download/${objectId}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': CHAOXING_FILE_UA,
        'Referer': '',
        'Accept': '*/*',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ChaoxingFileError('下载超星文件超时', 'timeout');
    }
    throw new ChaoxingFileError(`下载超星文件失败: ${(err as Error).message}`, 'unknown');
  }

  try {
    // 手动跟随 3xx，确保每一跳 Referer 都为空
    let redirectCount = 0;
    while (response.status >= 300 && response.status < 400) {
      if (redirectCount >= 5) {
        throw new ChaoxingFileError('超星文件下载重定向次数过多', 'unknown');
      }
      const location = response.headers.get('location');
      if (!location) break;
      response.body?.cancel().catch(() => {});
      const nextUrl = new URL(location, url);
      if (nextUrl.protocol !== 'https:' && nextUrl.protocol !== 'http:') {
        throw new ChaoxingFileError(`非法的重定向地址: ${nextUrl.protocol}`, 'unknown');
      }
      response = await fetch(nextUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': CHAOXING_FILE_UA,
          'Referer': '',
          'Accept': '*/*',
        },
      });
      redirectCount++;
    }

    if (response.status === 403) {
      throw new ChaoxingFileError('超星防盗链校验失败（UA 白名单未生效或 Referer 非空）', 'forbidden', 403);
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

    const fileName = parseFileName(response.headers.get('content-disposition'), opts.fallbackName ?? null);
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
