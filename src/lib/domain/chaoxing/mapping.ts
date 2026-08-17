import { flattenFields, toIsoFromEpoch, type FlatField } from './parser';
import type { ChaoxingField } from './types';

/**
 * 字段映射配置（保存在 system_configs.chaoxing_form_trip 的 value 中）。
 * 联调时把具体字段别名填进来；在拿到别名前，by=label 作为兜底。
 */
export interface FieldMappingEntry {
  by: 'alias' | 'label';
  value: string;
}

export interface ChaoxingFormConfig {
  formId: string;
  formAlias?: string;
  business: 'trip';
  fieldMapping: Record<string, FieldMappingEntry>;
}

export interface TripFromExternalInput {
  schoolName: string;
  department: string | null;
  industry: string | null;
  supportType: string;
  supportTypeOther?: string | null;
  products: string[];
  detail: string;
  tripDate: string; // YYYY-MM-DD
  startTime: string | null;
  endTime: string | null;
  salesManager: string | null;
  projectManager: string | null;
  initiator: string | null;
  isCompleted: string | null;
  reportConsistent: string | null;
  serviceSummary: string | null;
  salesLate: string | null;
  salesScore: number | null;
  serviceLate: string | null;
  overallScore: number | null;
  overallFeedback: string | null;
}

function findField(
  byAlias: Map<string, FlatField>,
  byLabel: Map<string, FlatField>,
  entry: FieldMappingEntry | undefined,
): FlatField | null {
  if (!entry) return null;
  if (entry.by === 'alias') {
    return byAlias.get(entry.value) ?? byLabel.get(entry.value) ?? null;
  }
  return byLabel.get(entry.value) ?? byAlias.get(entry.value) ?? null;
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t || null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => asString(v)).filter(Boolean).join(',');
  return null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v.trim() : v != null ? String(v) : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asDateOnly(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    // ISO 字符串
    const iso = new Date(t);
    if (!Number.isNaN(iso.getTime())) {
      // 纯日期（YYYY-MM-DD）按 UTC 解析，避免被运行环境时区改写
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
      return iso.toISOString().slice(0, 10);
    }
    return t.slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  return null;
}

function asTimeOnly(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    const match = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) return `${match[1].padStart(2, '0')}:${match[2]}:00`;
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(11, 19);
  }
  return null;
}

/**
 * 将超星 data 字段按配置映射成 TripRequest 输入。
 * 缺失必填字段时抛错，由接口层返回逐条失败。
 */
export function mapChaoxingDataToTrip(
  fields: ChaoxingField[],
  config: ChaoxingFormConfig,
  operator: { uid: string; originUid: string; inserttime: string; updatetime: string },
): TripFromExternalInput {
  const { byAlias, byLabel } = flattenFields(fields);
  const get = (key: string) => findField(byAlias, byLabel, config.fieldMapping[key]);

  const schoolName = asString(get('schoolName')?.value);
  const supportType = asString(get('supportType')?.value);
  const tripDate = asDateOnly(get('tripDate')?.value);
  const detail = asString(get('detail')?.value);

  const missing: string[] = [];
  if (!schoolName) missing.push('schoolName');
  if (!supportType) missing.push('supportType');
  if (!tripDate) missing.push('tripDate');
  if (!detail) missing.push('detail');
  if (missing.length > 0) {
    throw new Error(`缺少必填字段映射：${missing.join(', ')}（请检查字段别名或标题）`);
  }

  return {
    schoolName: schoolName as string,
    department: asString(get('department')?.value),
    industry: asString(get('industry')?.value),
    supportType: supportType as string,
    products: asStringArray(get('products')?.value),
    detail: detail as string,
    tripDate: tripDate as string,
    startTime: asTimeOnly(get('startTime')?.value),
    endTime: asTimeOnly(get('endTime')?.value),
    salesManager: asString(get('salesManager')?.value),
    projectManager: asString(get('projectManager')?.value),
    initiator: operator.originUid || operator.uid || null,
    isCompleted: asString(get('isCompleted')?.value),
    reportConsistent: asString(get('reportConsistent')?.value),
    serviceSummary: asString(get('serviceSummary')?.value),
    salesLate: asString(get('salesLate')?.value),
    salesScore: asNumber(get('salesScore')?.value),
    serviceLate: asString(get('serviceLate')?.value),
    overallScore: asNumber(get('overallScore')?.value),
    overallFeedback: asString(get('overallFeedback')?.value),
  };
}

export function mapEpochToIso(epoch: string | null | undefined): string | null {
  return toIsoFromEpoch(epoch);
}
