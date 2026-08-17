// 超星风格 formData 展平：把 [{compt, alias, values}] 转成 { alias: value }
// 与 trips 的 chaoxing 解析保持一致的取值规则

export interface ChaoxingFileValue {
  name: string;
  objectId?: string;
  resid?: string;
  suffix?: string;
  size?: string;
  byteSize?: string;
  puid?: number;
  enc?: string;
  modifyDate?: number;
}

export interface ChaoxingContactValue {
  puid?: number;
  uname?: string;
  enc?: string;
  unoids?: string;
}

export interface ChaoxingField {
  compt: string;
  alias?: string | number;
  id?: number;
  label?: string;
  values?: unknown;
  fields?: unknown;
}

type FlatValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | ChaoxingContactValue[]
  | ChaoxingFileValue[]
  | { html: string; text: string };

function firstValue(field: ChaoxingField): unknown {
  const values = Array.isArray(field.values) ? field.values : [];
  return values.length > 0 ? values[0] : null;
}

function asText(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw.trim() ? raw.trim() : null;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw === 'object') {
    const v = raw as Record<string, unknown>;
    if (typeof v.val === 'string' && v.val.trim()) return v.val.trim();
    if (typeof v.content === 'string' && v.content.trim()) return v.content.trim();
    if (typeof v.uname === 'string') return v.uname;
    if (typeof v.name === 'string') return v.name;
  }
  return null;
}

function asNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (raw && typeof raw === 'object') {
    const v = raw as Record<string, unknown>;
    if (typeof v.realNumVal === 'number') return v.realNumVal;
    if (typeof v.realNumVal === 'string' && v.realNumVal.trim() !== '') {
      const n = Number(v.realNumVal);
      if (Number.isFinite(n)) return n;
    }
    if (typeof v.val === 'number') return v.val;
    if (typeof v.val === 'string' && v.val.trim() !== '') {
      const n = Number(v.val);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function asBoolean(raw: unknown): boolean | null {
  const text = asText(raw);
  if (text == null) return null;
  if (['是', 'true', '1', 'yes', 'Y'].includes(text)) return true;
  if (['否', 'false', '0', 'no', 'N'].includes(text)) return false;
  return null;
}

function asDate(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    // YYYY-MM-DD 或 YYYY-MM-DD HH:mm：直接截取日期，不走 new Date()，避免 UTC 导致前一天
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    const n = Number(text);
    if (Number.isFinite(n)) return new Date(n).toISOString();
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw).toISOString();
  }
  if (typeof raw === 'object') {
    const v = raw as Record<string, unknown>;
    if (typeof v.val === 'string') return asDate(v.val);
    if (typeof v.realDateVal === 'string') return asDate(v.realDateVal);
    if (typeof v.realDateVal === 'number' && Number.isFinite(v.realDateVal)) {
      return new Date(v.realDateVal).toISOString();
    }
  }
  return null;
}

function asContact(field: ChaoxingField): ChaoxingContactValue[] {
  if (!Array.isArray(field.values)) return [];
  return field.values
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v) => ({
      puid: typeof v.puid === 'number' ? v.puid : undefined,
      uname: typeof v.uname === 'string' ? v.uname : undefined,
      enc: typeof v.enc === 'string' ? v.enc : undefined,
      unoids: typeof v.unoids === 'string' ? v.unoids : undefined,
    }));
}

function asFile(field: ChaoxingField): ChaoxingFileValue[] {
  if (!Array.isArray(field.values)) return [];
  return field.values
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v) => ({
      name: typeof v.name === 'string' ? v.name : '未命名文件',
      objectId: typeof v.objectId === 'string' ? v.objectId : undefined,
      resid: typeof v.resid === 'string' ? v.resid : undefined,
      suffix: typeof v.suffix === 'string' ? v.suffix : undefined,
      size: typeof v.size === 'string' ? v.size : undefined,
      byteSize: typeof v.byteSize === 'string' ? v.byteSize : undefined,
      puid: typeof v.puid === 'number' ? v.puid : undefined,
      enc: typeof v.enc === 'string' ? v.enc : undefined,
      modifyDate: typeof v.modifyDate === 'number' ? v.modifyDate : undefined,
    }));
}

function asMultiSelect(field: ChaoxingField): string[] {
  if (!Array.isArray(field.values)) return [];
  return field.values
    .map((v) => asText(v))
    .filter((v): v is string => !!v);
}

function asRichText(field: ChaoxingField): { html: string; text: string } {
  const first = firstValue(field);
  let html = '';
  let text = '';
  if (first && typeof first === 'object') {
    const v = first as Record<string, unknown>;
    if (typeof v.val === 'string') html = v.val;
    if (typeof v.content === 'string') text = v.content;
  } else if (typeof first === 'string') {
    html = first;
    text = first;
  }
  return { html, text };
}

/**
 * 把超星 formData 数组展平为 { alias: value } 映射。
 * value 类型因 compt 而异：
 * - editinput/edittextarea: string
 * - selectbox/radiobutton: string
 * - multipleselect: string[]
 * - numberinput: number
 * - dateinput: ISO string
 * - contact: ContactValue[]
 * - fileupload: FileValue[]
 * - richtext: { html, text }
 */
export function flattenChaoxingFormData(formData: unknown): Record<string, FlatValue> {
  if (typeof formData === 'string') {
    try {
      return flattenChaoxingFormData(JSON.parse(formData));
    } catch {
      return {};
    }
  }
  if (!Array.isArray(formData)) return {};

  const result: Record<string, FlatValue> = {};
  for (const raw of formData) {
    if (!raw || typeof raw !== 'object') continue;
    const field = raw as ChaoxingField;
    const alias = field.alias != null ? String(field.alias) : null;
    if (!alias) continue;

    const compt = String(field.compt || '').toLowerCase();
    switch (compt) {
      case 'contact':
        result[alias] = asContact(field);
        break;
      case 'fileupload':
        result[alias] = asFile(field);
        break;
      case 'multipleselect':
        result[alias] = asMultiSelect(field);
        break;
      case 'richtext':
        result[alias] = asRichText(field);
        break;
      case 'numberinput':
        result[alias] = asNumber(firstValue(field));
        break;
      case 'dateinput':
        result[alias] = asDate(firstValue(field));
        break;
      case 'radiobutton':
      case 'checkbox': {
        // 是/否 → boolean，其他 → 文本
        const text = asText(firstValue(field));
        const bool = asBoolean(firstValue(field));
        result[alias] = bool !== null ? bool : text;
        break;
      }
      case 'selectbox':
      case 'editinput':
      case 'edittextarea':
      default:
        result[alias] = asText(firstValue(field));
        break;
    }
  }
  return result;
}
