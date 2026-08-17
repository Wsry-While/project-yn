import type { BiddingFileRef } from '@/lib/domain/types';

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string') return value ? [value] : [];
  return [];
}

/**
 * 把任意输入标准化成单个文件引用。
 * 支持 url/href/path 三种链接字段，也兼容超星 fileupload 对象
 *（只有 name/objectId/resid，没有可访问 URL，此时 url=null，保留 objectId 用于将来换取下载链接）。
 */
export function normalizeFile(value: unknown): BiddingFileRef | null {
  if (!value) return null;
  if (typeof value === 'string') return { name: null, url: value };
  if (Array.isArray(value)) return normalizeFile(value[0]);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const url =
      typeof obj.url === 'string' && obj.url.trim()
        ? obj.url.trim()
        : typeof obj.href === 'string' && obj.href.trim()
          ? obj.href.trim()
          : typeof obj.path === 'string' && obj.path.trim()
            ? obj.path.trim()
            : null;
    const objectId =
      typeof obj.objectId === 'string' && obj.objectId.trim() ? obj.objectId.trim() : null;
    const resid =
      typeof obj.resid === 'string' && obj.resid.trim() ? obj.resid.trim() : null;
    // 既没有外链也没有超星 objectId，无法定位文件
    if (!url && !objectId && !resid) return null;
    return {
      url,
      objectId,
      resid,
      name:
        typeof obj.name === 'string'
          ? obj.name
          : typeof obj.fileName === 'string'
            ? obj.fileName
            : null,
      size:
        typeof obj.byteSize === 'string' && obj.byteSize.trim()
          ? Number(obj.byteSize)
          : typeof obj.size === 'number'
            ? obj.size
            : null,
      type:
        typeof obj.suffix === 'string'
          ? obj.suffix
          : typeof obj.type === 'string'
            ? obj.type
            : typeof obj.contentType === 'string'
              ? obj.contentType
              : null,
    };
  }
  return null;
}

export function normalizeFiles(value: unknown): BiddingFileRef[] {
  if (Array.isArray(value)) return value.map(normalizeFile).filter((x): x is BiddingFileRef => !!x);
  const one = normalizeFile(value);
  return one ? [one] : [];
}

export function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '是'].includes(t)) return true;
    if (['false', '0', 'no', 'n', '否'].includes(t)) return false;
  }
  return null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toDateString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1]; // 直接截 YYYY-MM-DD，避免 new Date() 按 UTC 解析导致时区偏移
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

export function pickString(body: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = body[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
    // rich text: {html, text}
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if (typeof obj.text === 'string' && obj.text.trim()) return obj.text.trim();
      if (typeof obj.html === 'string' && obj.html.trim()) {
        // strip HTML tags
        return obj.html.replace(/<[^>]+>/g, '').trim();
      }
    }
  }
  return null;
}

export function pickStrings(body: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    if (body[key] !== undefined) return toStringArray(body[key]);
  }
  return [];
}

export function pickContactName(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    return value
      .map((v) => pickContactName(v))
      .filter((v): v is string => !!v)
      .join('、');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.uname === 'string' && obj.uname.trim()) return obj.uname.trim();
    if (typeof obj.name === 'string' && obj.name.trim()) return obj.name.trim();
  }
  return null;
}
