import type {
  ChaoxingField,
  ExtractedContact,
  ExtractedRichText,
  ExtractedValue,
  TripFieldKey,
} from './types';
import { flattenFields } from './parser';

/**
 * 项目外出（formId=253633）字段按 alias 固定映射。
 *
 * 真实报文约定：
 *  alias 1  编号
 *  alias 35 所属年度
 *  alias 3  负责销售经理（contact）
 *  alias 33 学校
 *  alias 27 所属行业
 *  alias 4  外出支持类型（selectbox，含"其他"）
 *  alias 23 其他类型文本（选择"其他"时填写，label 与 alias=4 相同）
 *  alias 26 所属产品（selectmultibox）
 *  alias 8  具体事宜（richtext）
 *  alias 9  外出日期
 *  alias 10 预计开始时间
 *  alias 11 预计结束时间
 *  alias 36 周几（1=周一 ... 7=周日）
 *  alias 13 指派项目经理（contact）
 *  alias 14 是否完成（是/否）
 *  alias 37 汇报内容和前期沟通是否一致
 *  alias 15 服务内容简述（richtext）
 *  alias 28 销售是否迟到
 *  alias 16 给销售人员打分（rate）
 *  alias 29 服务部人员是否迟到
 *  alias 32 本次外出评价得分（rate）
 *  alias 17 整体评价/后续跟进（richtext）
 */
export const TRIP_FIELD_ALIASES: Record<TripFieldKey, string> = {
  serialNo: '1',
  year: '35',
  salesManager: '3',
  schoolName: '33',
  industry: '27',
  supportType: '4',
  supportTypeOther: '23',
  products: '26',
  detail: '8',
  tripDate: '9',
  startAt: '10',
  endAt: '11',
  weekday: '36',
  projectManager: '13',
  isCompleted: '14',
  reportConsistent: '37',
  serviceSummary: '15',
  salesLate: '28',
  salesScore: '16',
  serviceLate: '29',
  overallScore: '32',
  overallFeedback: '17',
};

export interface MappedTripData {
  serialNo: string | null;
  year: number | null;
  salesManager: ExtractedContact | null;
  schoolName: string | null;
  industry: string | null;
  supportType: string | null;
  supportTypeOther: string | null;
  products: string[];
  detail: ExtractedRichText | null;
  tripDate: string | null;
  startAt: string | null;
  endAt: string | null;
  weekday: number | null;
  projectManager: ExtractedContact | null;
  isCompleted: boolean;
  reportConsistent: boolean | null;
  serviceSummary: ExtractedRichText | null;
  salesLate: boolean | null;
  salesScore: number | null;
  serviceLate: boolean | null;
  overallScore: number | null;
  overallFeedback: ExtractedRichText | null;
}

function isContact(v: ExtractedValue): v is ExtractedContact {
  return !!v && typeof v === 'object' && !Array.isArray(v) && ('name' in v || 'puid' in v);
}

function isRichText(v: ExtractedValue): v is ExtractedRichText {
  return !!v && typeof v === 'object' && !Array.isArray(v) && ('html' in v || 'text' in v);
}

function asString(v: ExtractedValue): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function asNumber(v: ExtractedValue): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringArray(v: ExtractedValue): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x.trim() : x == null ? '' : String(x).trim()))
      .filter(Boolean);
  }
  const s = asString(v);
  return s ? [s] : [];
}

function asYesNo(v: ExtractedValue): boolean | null {
  const s = asString(v);
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (['是', 'yes', 'y', 'true', '1'].includes(t)) return true;
  if (['否', 'no', 'n', 'false', '0'].includes(t)) return false;
  return null;
}

function asContact(v: ExtractedValue): ExtractedContact | null {
  if (isContact(v)) return v;
  const name = asString(v);
  return name ? { name, puid: null, enc: null, uidEnc: null } : null;
}

function asRichText(v: ExtractedValue): ExtractedRichText | null {
  if (isRichText(v)) return v;
  const text = asString(v);
  return text ? { html: null, text } : null;
}

export class MapFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapFieldError';
  }
}

/**
 * 将超星表单 data 数组映射为项目外出业务数据。
 * 优先按 alias 取字段，缺失时才回退到 label（兼容配置变化）。
 */
export function mapTripFields(fields: ChaoxingField[]): MappedTripData {
  const { byAlias } = flattenFields(fields);
  const v = (key: TripFieldKey): ExtractedValue => byAlias.get(TRIP_FIELD_ALIASES[key])?.value ?? null;

  const supportType = asString(v('supportType'));
  if (!supportType) {
    throw new MapFieldError('缺少必填字段：外出支持类型（alias=4）');
  }
  const schoolName = asString(v('schoolName'));
  if (!schoolName) {
    throw new MapFieldError('缺少必填字段：学校（alias=33）');
  }

  return {
    serialNo: asString(v('serialNo')),
    year: asNumber(v('year')),
    salesManager: asContact(v('salesManager')),
    schoolName,
    industry: asString(v('industry')),
    supportType,
    supportTypeOther: supportType === '其他' ? asString(v('supportTypeOther')) : null,
    products: asStringArray(v('products')),
    detail: asRichText(v('detail')),
    tripDate: asString(v('tripDate')),
    startAt: asString(v('startAt')),
    endAt: asString(v('endAt')),
    weekday: asNumber(v('weekday')),
    projectManager: asContact(v('projectManager')),
    isCompleted: asYesNo(v('isCompleted')) ?? false,
    reportConsistent: asYesNo(v('reportConsistent')),
    serviceSummary: asRichText(v('serviceSummary')),
    salesLate: asYesNo(v('salesLate')),
    salesScore: asNumber(v('salesScore')),
    serviceLate: asYesNo(v('serviceLate')),
    overallScore: asNumber(v('overallScore')),
    overallFeedback: asRichText(v('overallFeedback')),
  };
}
