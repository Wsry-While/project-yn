import type {
  ChaoxingField,
  ChaoxingOp,
  ChaoxingPushPayload,
  ChaoxingValue,
  ExtractedValue,
} from './types';

const VALID_OPS: ChaoxingOp[] = [
  'data_create',
  'data_update',
  'data_remove',
  'data_recover',
  'form_update',
];

function asString(value: FormDataEntryValue | null): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return ''; // 不处理文件
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

/**
 * 把毫秒时间戳或 "YYYY-MM-DD HH:mm" 字符串转为 ISO。
 */
function toDateString(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number' && Number.isFinite(input)) {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // 纯数字字符串当作毫秒
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
    return d.toISOString().slice(11, 16);
  }
  const s = String(input).trim();
  if (!s) return null;
  // "2023-09-18 09:00" 或 "09:00"
  const match = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const hh = match[1].padStart(2, '0');
    return `${hh}:${match[2]}:00`;
  }
  // 数字毫秒
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

/**
 * 按 compt 类型提取字段值，用于业务层再映射。
 */
export function extractFieldValue(field: ChaoxingField): ExtractedValue {
  const compt = (field.compt || '').toLowerCase();

  // 多值类型：联系人、多选、附件、图片、视频
  if (compt === 'contact') {
    return allValues(field)
      .map((v) => v.uname ?? (v.val != null ? String(v.val) : ''))
      .filter(Boolean)
      .join(',');
  }
  if (compt === 'checkbox' || compt === 'multiselect' || compt === 'checkgroup') {
    return allValues(field)
      .map((v) => (v.val != null ? String(v.val) : ''))
      .filter(Boolean);
  }
  if (['image', 'video', 'attachment', 'annex', 'annedueditor'].includes(compt)) {
    return allValues(field)
      .map((v) => String(v.url ?? v.val ?? ''))
      .filter(Boolean);
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
  if (v.val === undefined || v.val === null) return null;
  if (typeof v.val === 'string') return v.val;
  if (typeof v.val === 'number' || typeof v.val === 'boolean') return String(v.val);
  return null;
}

export function getFieldLabel(field: ChaoxingField): string {
  if (field.fields?.[0]?.label) return field.fields[0].label.trim();
  return '';
}

/**
 * 将字段数组展开成便于按 alias/label 查询的结构。
 */
export interface FlatField {
  field: ChaoxingField;
  label: string;
  value: ExtractedValue;
}

function isEmptyValue(v: ExtractedValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (typeof v === 'number') return false;
  if (Array.isArray(v)) return v.length === 0 || v.every((x) => x === null || x === undefined || String(x).trim() === '');
  return false;
}

export function flattenFields(fields: ChaoxingField[]): {
  byAlias: Map<string, FlatField>;
  byLabel: Map<string, FlatField>;
  byLabelAll: Map<string, FlatField[]>;
} {
  const byAlias = new Map<string, FlatField>();
  const byLabel = new Map<string, FlatField>();
  const byLabelAll = new Map<string, FlatField[]>();
  for (const field of fields) {
    const label = getFieldLabel(field);
    const flat: FlatField = { field, label, value: extractFieldValue(field) };
    if (field.alias) byAlias.set(String(field.alias), flat);
    if (label) {
      // 同 label 下优先保留有值的字段；若已有值，新字段为空则不覆盖
      const existing = byLabel.get(label);
      if (!existing || (isEmptyValue(existing.value) && !isEmptyValue(flat.value))) {
        byLabel.set(label, flat);
      }
      const arr = byLabelAll.get(label) ?? [];
      arr.push(flat);
      byLabelAll.set(label, arr);
    }
  }
  return { byAlias, byLabel, byLabelAll };
}

export function toIsoFromEpoch(epoch: string | null | undefined): string | null {
  if (!epoch) return null;
  const n = Number(epoch);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
