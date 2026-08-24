/**
 * 核心领域类型定义 —— 项目中心（学校业务版）
 */

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'p0' | 'p1' | 'p2' | 'p3';
export type ProjectStatus = 'active' | 'archived' | 'deleted';
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';

export type ProjectType = 'bidding' | 'qiming' | 'construction' | 'operation' | 'other';

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  bidding: '招投标',
  qiming: '启明星建设',
  construction: '项目建设',
  operation: '日常运营',
  other: '其他',
};

export type TaskType =
  | 'general'
  | 'trip'
  | 'bidding_screenshot'
  | 'qiming_build'
  | 'project_build';

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  general: '通用',
  trip: '项目外出',
  bidding_screenshot: '招投标截图',
  qiming_build: '启明星建设',
  project_build: '项目建设',
};

export interface ProjectSettings {
  notifications: {
    taskAssigned: boolean;
    taskCompleted: boolean;
    taskDueSoon: boolean;
    taskOverdue: boolean;
    projectUpdates: boolean;
    weeklyDigest: boolean;
  };
  workflow: {
    requireReview: boolean;
    allowExternalPush: boolean;
  };
}

export interface School {
  id: string;
  name: string;
  industry: string | null;
  province: string | null;
  city: string | null;
  level: string | null;
  externalId: string | null;
  externalSource: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolDepartment {
  id: string;
  schoolId: string;
  name: string;
  salesOwner: string | null;
  submitter: string | null;
  submitterUid: string | null;
  salesTeam: string | null;
  mobile: string | null;
  staffNo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolWithDepartments extends School {
  departments: SchoolDepartment[];
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  status: ProjectStatus;
  projectType: ProjectType;
  schoolId: string | null;
  departmentId: string | null;
  industry: string | null;
  products: string[];
  startDate: string | null;
  endDate: string | null;
  settings: ProjectSettings;
  externalId: string | null;
  externalSource: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  projectId: string;
  userId: string;
  role: MemberRole;
  displayName: string | null;
  title: string | null;
  avatarUrl: string | null;
  joinedAt: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  position: number;
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  milestoneId: string | null;
  schoolId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  taskType: TaskType;
  products: string[];
  assigneeId: string | null;
  reporterId: string | null;
  dueDate: string | null;
  position: number;
  externalId: string | null;
  externalSource: string | null;
  sourceType: string | null;
  sourceId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type TripApprovalStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export interface TripContact {
  name: string | null;
  puid: string | null;
  enc: string | null;
  uidEnc: string | null;
}

export interface TripRichText {
  html: string | null;
  text: string | null;
}

export interface TripRequest {
  id: string;
  externalSource: string;
  externalId: string | null;
  externalUuid: string | null;
  externalSerial: string | null;
  externalOp: string | null;
  externalOperator: string | null;
  externalOperatorName: string | null;
  externalOriginOperator: string | null;
  auditStatus: number | null;
  approvalStatus: TripApprovalStatus;
  deletedAt: string | null;
  rawPayload: Record<string, unknown> | null;
  rawMeta: Record<string, unknown> | null;
  syncedAt: string;

  year: number | null;
  schoolId: string | null;
  schoolName: string;
  industry: string | null;
  industryNorm: string | null;
  supportType: string;
  supportTypeNorm: string | null;
  supportTypeOther: string | null;
  products: string[];
  productsNorm: string[];
  detail: TripRichText | null;
  tripDate: string;
  startAt: string | null;
  endAt: string | null;
  weekday: number | null;
  salesManagerId: string | null;
  salesManager: TripContact | null;
  projectManagerId: string | null;
  projectManager: TripContact | null;

  isCompleted: boolean;
  reportConsistent: boolean | null;
  serviceSummary: TripRichText | null;
  salesLate: boolean | null;
  salesScore: number | null;
  serviceLate: boolean | null;
  overallScore: number | null;
  overallFeedback: TripRichText | null;
  completedAt: string | null;

  projectId: string | null;
  derivedTaskId: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface TripOptionDict {
  id: string;
  fieldKey: string;
  sourceValue: string;
  label: string;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BiddingFileStorageStatus = 'pending' | 'fetching' | 'stored' | 'failed' | 'direct';

export interface BiddingFileRef {
  name: string | null;
  url: string | null;
  objectId?: string | null;
  resid?: string | null;
  enc?: string | null;
  puid?: number | null;
  suffix?: string | null;
  size?: string | null;
  byteSize?: number | null;
  modifyDate?: number | null;
  type?: string | null;
  // 转存到我方对象存储后的状态
  assetId?: string | null;
  bucket?: string | null;
  storageKey?: string | null;
  storageStatus?: BiddingFileStorageStatus;
  storedAt?: string | null;
  storageError?: string | null;
}

export interface BiddingScreenshot {
  id: string;
  externalSource: string;
  externalId: string | null;
  externalSerial: string | null;
  externalOp: string | null;
  externalOperator: string | null;
  rawPayload: Record<string, unknown> | null;
  rawMeta: Record<string, unknown> | null;
  syncedAt: string;
  deletedAt: string | null;

  salesManager: string;
  salesManagerId: string | null;
  projectName: string;
  projectSchool: string;
  projectSecondaryUnit: string | null;
  isCompanyParameter: boolean;
  submissionDate: string;
  dueDeliveryDate: string | null;
  reservedDays: number | null;
  projectBiddingFile: BiddingFileRef | null;
  projectCategory: string[];
  projectCategoryNorm: string[];
  screenshotRequirement: string | null;
  assignedProjectManager: string | null;
  assignedPmId: string | null;
  completionStatus: string | null;
  completionStatusNorm: string | null;
  deliveryDocument: BiddingFileRef | null;
  deliveryRemark: string | null;
  isMeetScreenshotRequirement: boolean | null;
  salesFeedback: string | null;
  attachments: BiddingFileRef[];
  rectificationFeedback: string | null;
  rectifiedDocument: BiddingFileRef | null;

  schoolId: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============== 项目建设申请（超星推送） ==============

export interface ProjectDemand {
  id: string;
  externalSource: string;
  externalId: string | null;
  externalOp: string | null;
  externalSerial: string | null;
  externalOperator: string | null;

  projectYear: string | null;
  salesManager: string | null;
  salesManagerId: string | null;
  demandType: string | null;
  demandTypeNorm: string | null;
  product: string[];
  company: string | null;
  schoolId: string | null;
  industryCategory: string | null;
  industryCategoryNorm: string | null;
  demandDescHtml: string | null;
  demandDescText: string | null;
  providedMaterials: BiddingFileRef[];
  requiredFinishDate: string | null;
  projectManager: string | null;
  projectManagerId: string | null;
  completionStatus: string | null;
  estimatedFinishDate: string | null;
  deliveryContent: string | null;
  otherDeliveryContent: string | null;
  deliveryDocType: string[];
  deliveryDocs: BiddingFileRef[];
  deliveryRemark: string | null;

  rawPayload: Record<string, unknown> | null;
  rawMeta: Record<string, unknown> | null;
  syncedAt: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDemandInput {
  externalId: string;
  externalSource: string;
  externalOp?: string | null;
  externalSerial?: string | null;
  externalOperator?: string | null;
  projectYear: string | null;
  salesManager: string;
  salesManagerId?: string | null;
  demandType: string | null;
  demandTypeNorm?: string | null;
  product: string[];
  company: string;
  schoolId?: string | null;
  industryCategory: string | null;
  industryCategoryNorm?: string | null;
  demandDescHtml: string | null;
  demandDescText: string | null;
  providedMaterials: BiddingFileRef[];
  requiredFinishDate: string | null;
  projectManager: string | null;
  projectManagerId?: string | null;
  completionStatus: string | null;
  estimatedFinishDate: string | null;
  deliveryContent: string | null;
  otherDeliveryContent: string | null;
  deliveryDocType: string[];
  deliveryDocs: BiddingFileRef[];
  deliveryRemark: string | null;
  rawPayload?: unknown;
  rawMeta?: unknown;
}

// ============== 基础数据：员工 ==============

export interface TeamMember {
  id: string;
  puid: string | null;
  name: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  active: boolean;
  syncedFrom: string;
  contactRaw: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberInput {
  puid?: string | null;
  name: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  active?: boolean;
  syncedFrom?: string;
  contactRaw?: Record<string, unknown> | null;
}

// ============== 基础数据：字典 ==============

export interface DictOption {
  id: string;
  category: string;
  value: string;
  aliases: string[];
  sortOrder: number;
  active: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

// ============== 启明星建设（超星推送） ==============

export interface QimingConstruction {
  id: string;
  externalSource: string;
  externalId: string | null;
  externalOp: string | null;
  externalSerial: string | null;
  externalOperator: string | null;

  salesManager: string | null;
  salesManagerId: string | null;
  projectYear: string | null;
  projectName: string | null;
  isSignContract: boolean | null;
  school: string | null;
  schoolId: string | null;
  college: string | null;
  collegeId: string | null;
  schoolLevel: string | null;
  schoolLevelNorm: string | null;
  buildMajor: string | null;
  buildMajorNorm: string | null;
  buildContentHtml: string | null;
  buildContentText: string | null;
  buildSpecialDescHtml: string | null;
  buildSpecialDescText: string | null;
  projectMaterials: BiddingFileRef[];
  projectDeliveryTime: string | null;
  projectManager: string | null;
  projectManagerId: string | null;
  projectStatusFeedback: string | null;

  rawPayload: Record<string, unknown> | null;
  rawMeta: Record<string, unknown> | null;
  syncedAt: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QimingConstructionInput {
  externalId: string;
  externalSource: string;
  externalOp?: string | null;
  externalSerial?: string | null;
  externalOperator?: string | null;

  salesManager: string | null;
  salesManagerId?: string | null;
  projectYear: string | null;
  projectName: string | null;
  isSignContract: boolean | null;
  school: string | null;
  schoolId?: string | null;
  college: string | null;
  collegeId?: string | null;
  schoolLevel: string | null;
  schoolLevelNorm?: string | null;
  buildMajor: string | null;
  buildMajorNorm?: string | null;
  buildContentHtml: string | null;
  buildContentText: string | null;
  buildSpecialDescHtml: string | null;
  buildSpecialDescText: string | null;
  projectMaterials: BiddingFileRef[];
  projectDeliveryTime: string | null;
  projectManager: string | null;
  projectManagerId?: string | null;
  projectStatusFeedback: string | null;

  rawPayload?: unknown;
  rawMeta?: unknown;
}

export interface ActivityLog {
  id: number;
  projectId: string | null;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityTitle: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待办',
  in_progress: '进行中',
  review: '审阅中',
  done: '已完成',
};

export const TASK_STATUS_ORDER: TaskStatus[] = ['todo', 'in_progress', 'review', 'done'];

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '观察者',
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  p0: 'P0 紧急',
  p1: 'P1 高',
  p2: 'P2 中',
  p3: 'P3 低',
};

export const PRIORITY_RANK: Record<TaskPriority, number> = {
  p0: 0,
  p1: 1,
  p2: 2,
  p3: 3,
};

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown } };
