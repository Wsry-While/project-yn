import type { BiddingFileRef } from '@/lib/domain/types';

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string') return value ? [value] : [];
  return [];
}

export function normalizeFile(value: unknown): BiddingFileRef | null {
  if (!value) return null;
  if (typeof value === 'string') return { name: null, url: value };
  if (Array.isArray(value)) return normalizeFile(value[0]);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const url = typeof obj.url === 'string' ? obj.url : typeof obj.href === 'string' ? obj.href : typeof obj.path === 'string' ? obj.path : null;
    if (!url) return null;
    return {
      url,
      name: typeof obj.name === 'string' ? obj.name : typeof obj.fileName === 'string' ? obj.fileName : null,
      size: typeof obj.size === 'number' ? obj.size : null,
      type: typeof obj.type === 'string' ? obj.type : typeof obj.contentType === 'string' ? obj.contentType : null,
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
    if (match) return match[1];
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
  }
  return null;
}

export function pickStrings(body: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    if (body[key] !== undefined) return toStringArray(body[key]);
  }
  return [];
}
