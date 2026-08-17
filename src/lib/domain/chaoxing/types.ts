/**
 * 超星表单推送报文相关类型定义。
 * 报文以 form 形式提交，业务字段封装在 `data` JSON 字符串数组中。
 */

export type ChaoxingOp =
  | 'data_create'
  | 'data_edit'
  | 'data_update'
  | 'data_flow'
  | 'data_remove'
  | 'data_recover'
  | 'form_update';

export interface ChaoxingValue {
  val?: unknown;
  content?: string;
  realNumVal?: number;
  realDateVal?: string | number;
  puid?: number | string;
  uname?: string;
  enc?: string;
  uidEnc?: string;
  name?: string;
  url?: string;
  size?: number;
  [key: string]: unknown;
}

export interface ChaoxingField {
  /** 字段 ID（数字） */
  id: number | string;
  /** 字段别名 */
  alias: string;
  /** 字段类型，例如 editinput/numberinput/dateinput/contact/... */
  compt: string;
  /** 字段展示标题，来自 fields[0].label（镜像字段） */
  label?: string;
  fields?: Array<{ label?: string; values?: ChaoxingValue[] }>;
  values?: ChaoxingValue[];
}

export interface ChaoxingPushPayload {
  op: ChaoxingOp;
  formId: string;
  formName: string;
  appName: string;
  formAlias: string;
  deptId: string;
  indexId: string;
  formUserId: string;
  uid: string;
  originUid: string;
  auditStatus: number | null;
  inserttime: string;
  updatetime: string;
  uuid: string;
  formType: number;
  data: ChaoxingField[];
}

export interface ExtractedContact {
  name: string | null;
  puid: string | null;
  enc: string | null;
  uidEnc: string | null;
}

export interface ExtractedRichText {
  html: string | null;
  text: string | null;
}

export type ExtractedValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | ExtractedContact
  | ExtractedRichText;

export type TripFieldKey =
  | 'serialNo'
  | 'year'
  | 'salesManager'
  | 'schoolName'
  | 'industry'
  | 'supportType'
  | 'supportTypeOther'
  | 'products'
  | 'detail'
  | 'tripDate'
  | 'startAt'
  | 'endAt'
  | 'weekday'
  | 'projectManager'
  | 'isCompleted'
  | 'reportConsistent'
  | 'serviceSummary'
  | 'salesLate'
  | 'salesScore'
  | 'serviceLate'
  | 'overallScore'
  | 'overallFeedback';
