import type {
  ChaoxingField,
  ChaoxingOp,
  ChaoxingPushPayload,
  ChaoxingValue,
  ExtractedValue,
} from './types';

const VALID_OPS: ChaoxingOp[] = [
  'data_create',
  'data_edit',
  'data_update',
  'data_flow',
  'data_remove',
  'data_recover',
  'form_update',
];

function asString(value: FormDataEntryValue | null): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return '';
}

function safeJsonParse(raw: string): ChaoxingField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ChaoxingField[];
  } catch {
    // ignore
  }
  return [];
}

function toNumber(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 解析 NextRequest 中的 form-data，得到超星推送报文。
 */
export async function parseChaoxingFormData(form: FormData): Promise<ChaoxingPushPayload> {
  const dataRaw = asString(form.get('data'));
  return {
    op: (asString(form.get('op')) as ChaoxingOp) || 'data_create',
    formId: asString(form.get('formId')),
    formName: asString(form.get('formName')),
    appName: asString(form.get('appName')),
    formAlias: asString(form.get('formAlias')) || asString(form.get('appName')),
    deptId: asString(form.get('deptId')),
    indexId: asString(form.get('indexID')) || asString(form.get('formUserId')),
    formUserId: asString(form.get('formUserId')),
    uid: asString(form.get('uid')),
    originUid: asString(form.get('originUid')),
    auditStatus: toNumber(asString(form.get('auditStatus'))),
    inserttime: asString(form.get('inserttime')),
    updatetime: asString(form.get('updatetime')),
    uuid: asString(form.get('uuid')),
    formType: toNumber(asString(form.get('formType'))) ?? 0,
    data: safeJsonParse(dataRaw),
  };
}

export function isValidOp(op: string): op is ChaoxingOp {
  return (VALID_OPS as string[]).includes(op);
}

function firstValue(field: ChaoxingField): ChaoxingValue | null {
  if (Array.isArray(field.values) && field.values.length > 0) return field.values[0];
  if (Array.isArray(field.fields) && field.fields[0]?.values?.length) {
    return field.fields[0].values[0];
  }
  return null;
}

function allValues(field: ChaoxingField): ChaoxingValue[] {
  if (Array.isArray(field.values) && field.values.length > 0) return field.values;
  if (Array.isArray(field.fields)) {
    const out: ChaoxingValue[] = [];
    for (const f of field.fields) {
      if (Array.isArray(f.values)) out.push(...f.values);
    }
    if (out.length) return out;
  }
  return [];
}

/** 把毫秒时间戳或 "YYYY-MM-DD HH:mm" 字符串转为 ISO。 */
function toDateString(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number' && Number.isFinite(input)) {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (/^\d{10,16}$/.test(trimmed)) {
      const d = new Date(Number(trimmed));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed}T00:00:00.000Z`;
    }
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(trimmed)
      ? trimmed.replace(' ', 'T') + '+08:00'
      : trimmed;
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function toTimeString(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(11, 19);
  }
  const s = String(input).trim();
  if (!s) return null;
  const match = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] ?? '00'}`;
  if (/^\d{10,16}$/.test(s)) {
    const d = new Date(Number(s));
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(11, 19);
  }
  return null;
}

function toNumberValue(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim() !== '') {
    const n = Number(input);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function valToString(v: ChaoxingValue | undefined | null): string | null {
  if (!v) return null;
  if (typeof v.val === 'string') {
    const t = v.val.trim();
    return t || null;
  }
  if (typeof v.val === 'number' || typeof v.val === 'boolean') return String(v.val);
  return null;
}

/**
 * 按 compt 类型提取字段值，业务层再按 alias 映射。
 * 返回类型约定：
 *  - contact → { name, puid, enc, uidEnc }
 *  - richtext → { html, text }
 *  - selectmultibox / checkbox → string[]
 *  - image/video/attachment → string[] (URL)
 *  - rate/numberinput → number | null
 *  - dateinput → ISO string
 *  - 其余 → string | null
 */
export function extractFieldValue(field: ChaoxingField): ExtractedValue {
  const compt = (field.compt || '').toLowerCase();

  if (compt === 'contact') {
    const v = firstValue(field);
    if (!v) return null;
    const name = v.uname ? v.uname.trim() : null;
    const puid = v.puid != null ? String(v.puid) : null;
    const enc = v.enc ? String(v.enc) : null;
    const uidEnc = v.uidEnc ? String(v.uidEnc) : null;
    if (!name && !puid && !enc) return null;
    return { name, puid, enc, uidEnc };
  }

  if (compt === 'richtext') {
    const v = firstValue(field);
    if (!v) return null;
    const html = typeof v.val === 'string' ? v.val.trim() : null;
    const text = typeof v.content === 'string' ? v.content.trim() : null;
    if (!html && !text) return null;
    return { html: html || null, text: text || stripHtml(html) };
  }

  if (
    compt === 'selectmultibox' ||
    compt === 'checkbox' ||
    compt === 'multiselect' ||
    compt === 'checkgroup'
  ) {
    return allValues(field)
      .map((v) => valToString(v))
      .filter((x): x is string => !!x);
  }

  if (['image', 'video', 'attachment', 'annex', 'annedueditor'].includes(compt)) {
    return allValues(field)
      .map((v) => String(v.url ?? v.val ?? ''))
      .filter(Boolean);
  }

  if (compt === 'rate') {
    const v = firstValue(field);
    return toNumberValue(v?.val);
  }

  const v = firstValue(field);
  if (!v) return null;

  if (compt === 'numberinput') {
    return v.realNumVal != null ? v.realNumVal : toNumberValue(v.val);
  }
  if (compt === 'dateinput') {
    return toDateString(v.realDateVal ?? v.val);
  }
  if (compt === 'timeinput') {
    return toTimeString(v.realDateVal ?? v.val);
  }

  // editinput / textarea / selectbox / radiobutton / autonumber / 兜底
  return valToString(v);
}

function stripHtml(html: string | null): string | null {
  if (!html) return null;
  return html
    .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function getFieldLabel(field: ChaoxingField): string {
  if (field.fields?.[0]?.label) return field.fields[0].label.trim();
  return field.label ? field.label.trim() : '';
}

export interface FlatField {
  field: ChaoxingField;
  label: string;
  value: ExtractedValue;
}

function isEmptyValue(v: ExtractedValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    return Object.values(v).every((x) => x === null || x === undefined || String(x).trim() === '');
  }
  return false;
}

export function flattenFields(fields: ChaoxingField[]): {
  byAlias: Map<string, FlatField>;
  byLabel: Map<string, FlatField>;
} {
  const byAlias = new Map<string, FlatField>();
  const byLabel = new Map<string, FlatField>();
  for (const field of fields) {
    const label = getFieldLabel(field);
    const flat: FlatField = { field, label, value: extractFieldValue(field) };
    if (field.alias) {
      const key = String(field.alias);
      const existing = byAlias.get(key);
      if (!existing || (isEmptyValue(existing.value) && !isEmptyValue(flat.value))) {
        byAlias.set(key, flat);
      }
    }
    if (label) {
      const existing = byLabel.get(label);
      if (!existing || (isEmptyValue(existing.value) && !isEmptyValue(flat.value))) {
        byLabel.set(label, flat);
      }
    }
  }
  return { byAlias, byLabel };
}

export function toIsoFromEpoch(epoch: string | null | undefined): string | null {
  if (!epoch) return null;
  const n = Number(epoch);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
