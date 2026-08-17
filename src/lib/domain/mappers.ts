/**
 * 领域对象与数据库行的映射，集中处理 snake_case → camelCase 转换。
 */
import type {
  Project,
  ProjectSettings,
  Task,
  Member,
  ActivityLog,
  School,
  SchoolDepartment,
  Milestone,
  TripRequest,
  TripOptionDict,
  BiddingScreenshot,
  BiddingFileRef,
} from '@/lib/domain/types';

interface SchoolRow {
  id: string;
  name: string;
  industry: string | null;
  province: string | null;
  city: string | null;
  level: string | null;
  external_id: string | null;
  external_source: string | null;
  created_at: string;
  updated_at: string;
}

interface DepartmentRow {
  id: string;
  school_id: string;
  name: string;
  sales_owner: string | null;
  submitter: string | null;
  submitter_uid: string | null;
  sales_team: string | null;
  mobile: string | null;
  staff_no: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  status: string;
  project_type: string;
  school_id: string | null;
  department_id: string | null;
  industry: string | null;
  products: string[] | null;
  start_date: string | null;
  end_date: string | null;
  settings: ProjectSettings | null;
  external_id: string | null;
  external_source: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  project_id: string;
  milestone_id: string | null;
  school_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  task_type: string;
  products: string[] | null;
  assignee_id: string | null;
  reporter_id: string | null;
  due_date: string | null;
  position: number;
  external_id: string | null;
  external_source: string | null;
  source_type: string | null;
  source_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  project_id: string;
  user_id: string;
  role: string;
  display_name: string | null;
  title: string | null;
  avatar_url: string | null;
  joined_at: string;
}

interface MilestoneRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  position: number;
  status: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ActivityRow {
  id: number;
  project_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_title: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

interface TripRow {
  id: string;
  external_source: string;
  external_id: string | null;
  external_uuid: string | null;
  external_serial: string | null;
  external_op: string | null;
  external_operator: string | null;
  external_operator_name: string | null;
  external_origin_operator: string | null;
  audit_status: number | null;
  approval_status: string;
  deleted_at: string | null;
  raw_payload: Record<string, unknown> | null;
  raw_meta: Record<string, unknown> | null;
  synced_at: string;
  year: number | null;
  school_id: string | null;
  school_name: string;
  industry: string | null;
  support_type: string;
  support_type_other: string | null;
  products: string[] | null;
  detail_html: string | null;
  detail_text: string | null;
  trip_date: string;
  start_at: string | null;
  end_at: string | null;
  weekday: number | null;
  sales_manager_name: string | null;
  sales_manager_puid: string | null;
  sales_manager_enc: string | null;
  project_manager_name: string | null;
  project_manager_puid: string | null;
  project_manager_enc: string | null;
  is_completed: boolean;
  report_consistent: boolean | null;
  service_summary_html: string | null;
  service_summary_text: string | null;
  sales_late: boolean | null;
  sales_score: number | null;
  service_late: boolean | null;
  overall_score: number | null;
  overall_feedback_html: string | null;
  overall_feedback_text: string | null;
  completed_at: string | null;
  project_id: string | null;
  derived_task_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TripOptionDictRow {
  id: string;
  field_key: string;
  source_value: string;
  label: string;
  color: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BiddingFileRefRow {
  name?: string | null;
  url?: string | null;
  size?: number | null;
  type?: string | null;
}

interface BiddingScreenshotRow {
  id: string;
  external_source: string;
  external_id: string | null;
  external_serial: string | null;
  external_op: string | null;
  external_operator: string | null;
  raw_payload: Record<string, unknown> | null;
  raw_meta: Record<string, unknown> | null;
  synced_at: string;
  deleted_at: string | null;
  sales_manager: string;
  project_name: string;
  project_school: string;
  project_secondary_unit: string | null;
  is_company_parameter: boolean;
  submission_date: string;
  due_delivery_date: string | null;
  reserved_days: number | null;
  project_bidding_file: BiddingFileRefRow | BiddingFileRefRow[] | null;
  project_category: string | null;
  screenshot_requirement: string | null;
  assigned_project_manager: string | null;
  completion_status: string | null;
  delivery_document: BiddingFileRefRow | BiddingFileRefRow[] | null;
  delivery_remark: string | null;
  is_meet_screenshot_requirement: boolean | null;
  sales_feedback: string | null;
  attachments: BiddingFileRefRow[] | null;
  rectification_feedback: string | null;
  rectified_document: BiddingFileRefRow | BiddingFileRefRow[] | null;
  school_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  notifications: {
    taskAssigned: true,
    taskCompleted: true,
    taskDueSoon: true,
    taskOverdue: true,
    projectUpdates: false,
    weeklyDigest: false,
  },
  workflow: {
    requireReview: false,
    allowExternalPush: false,
  },
};

export function mapSchool(row: SchoolRow): School {
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    province: row.province,
    city: row.city,
    level: row.level,
    externalId: row.external_id,
    externalSource: row.external_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDepartment(row: DepartmentRow): SchoolDepartment {
  return {
    id: row.id,
    schoolId: row.school_id,
    name: row.name,
    salesOwner: row.sales_owner,
    submitter: row.submitter,
    submitterUid: row.submitter_uid,
    salesTeam: row.sales_team,
    mobile: row.mobile,
    staffNo: row.staff_no,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    status: row.status as Project['status'],
    projectType: (row.project_type as Project['projectType']) ?? 'construction',
    schoolId: row.school_id,
    departmentId: row.department_id,
    industry: row.industry,
    products: row.products ?? [],
    startDate: row.start_date,
    endDate: row.end_date,
    settings: row.settings ?? DEFAULT_PROJECT_SETTINGS,
    externalId: row.external_id,
    externalSource: row.external_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    schoolId: row.school_id,
    title: row.title,
    description: row.description,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    taskType: (row.task_type as Task['taskType']) ?? 'general',
    products: row.products ?? [],
    assigneeId: row.assignee_id,
    reporterId: row.reporter_id,
    dueDate: row.due_date,
    position: row.position,
    externalId: row.external_id,
    externalSource: row.external_source,
    sourceType: row.source_type,
    sourceId: row.source_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapMember(row: MemberRow): Member {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    role: row.role as Member['role'],
    displayName: row.display_name,
    title: row.title,
    avatarUrl: row.avatar_url,
    joinedAt: row.joined_at,
  };
}

export function mapMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    position: row.position,
    status: row.status as Milestone['status'],
    dueDate: row.due_date,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapActivity(row: ActivityRow): ActivityLog {
  return {
    id: row.id,
    projectId: row.project_id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityTitle: row.entity_title,
    payload: row.payload ?? {},
    ip: row.ip,
    createdAt: row.created_at,
  };
}

export function mapTrip(row: TripRow): TripRequest {
  return {
    id: row.id,
    externalSource: row.external_source,
    externalId: row.external_id,
    externalUuid: row.external_uuid,
    externalSerial: row.external_serial,
    externalOp: row.external_op,
    externalOperator: row.external_operator,
    externalOperatorName: row.external_operator_name,
    externalOriginOperator: row.external_origin_operator,
    auditStatus: row.audit_status,
    approvalStatus: row.approval_status as TripRequest['approvalStatus'],
    deletedAt: row.deleted_at,
    rawPayload: row.raw_payload,
    rawMeta: row.raw_meta,
    syncedAt: row.synced_at,
    year: row.year,
    schoolId: row.school_id,
    schoolName: row.school_name,
    industry: row.industry,
    supportType: row.support_type,
    supportTypeOther: row.support_type_other,
    products: row.products ?? [],
    detail:
      row.detail_html || row.detail_text
        ? { html: row.detail_html, text: row.detail_text }
        : null,
    tripDate: row.trip_date,
    startAt: row.start_at,
    endAt: row.end_at,
    weekday: row.weekday,
    salesManager: row.sales_manager_name
      ? {
          name: row.sales_manager_name,
          puid: row.sales_manager_puid,
          enc: row.sales_manager_enc,
          uidEnc: null,
        }
      : null,
    projectManager: row.project_manager_name
      ? {
          name: row.project_manager_name,
          puid: row.project_manager_puid,
          enc: row.project_manager_enc,
          uidEnc: null,
        }
      : null,
    isCompleted: row.is_completed,
    reportConsistent: row.report_consistent,
    serviceSummary:
      row.service_summary_html || row.service_summary_text
        ? { html: row.service_summary_html, text: row.service_summary_text }
        : null,
    salesLate: row.sales_late,
    salesScore: row.sales_score,
    serviceLate: row.service_late,
    overallScore: row.overall_score,
    overallFeedback:
      row.overall_feedback_html || row.overall_feedback_text
        ? { html: row.overall_feedback_html, text: row.overall_feedback_text }
        : null,
    completedAt: row.completed_at,
    projectId: row.project_id,
    derivedTaskId: row.derived_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTripOptionDict(row: TripOptionDictRow): TripOptionDict {
  return {
    id: row.id,
    fieldKey: row.field_key,
    sourceValue: row.source_value,
    label: row.label,
    color: row.color,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFileRef(row: BiddingFileRefRow | BiddingFileRefRow[] | null | undefined): BiddingFileRef | null {
  const item = Array.isArray(row) ? row[0] : row;
  if (!item || typeof item.url !== 'string' || !item.url) return null;
  return {
    name: typeof item.name === 'string' ? item.name : null,
    url: item.url,
    size: typeof item.size === 'number' ? item.size : null,
    type: typeof item.type === 'string' ? item.type : null,
  };
}

function toFileRefs(row: BiddingFileRefRow[] | BiddingFileRefRow | null | undefined): BiddingFileRef[] {
  const items = Array.isArray(row) ? row : row ? [row] : [];
  return items
    .filter((x): x is BiddingFileRefRow => !!x && typeof x.url === 'string' && !!x.url)
    .map((x) => ({
      name: typeof x.name === 'string' ? x.name : null,
      url: x.url as string,
      size: typeof x.size === 'number' ? x.size : null,
      type: typeof x.type === 'string' ? x.type : null,
    }));
}

export function mapBiddingScreenshot(row: BiddingScreenshotRow): BiddingScreenshot {
  return {
    id: row.id,
    externalSource: row.external_source,
    externalId: row.external_id,
    externalSerial: row.external_serial,
    externalOp: row.external_op,
    externalOperator: row.external_operator,
    rawPayload: row.raw_payload,
    rawMeta: row.raw_meta,
    syncedAt: row.synced_at,
    deletedAt: row.deleted_at,
    salesManager: row.sales_manager,
    projectName: row.project_name,
    projectSchool: row.project_school,
    projectSecondaryUnit: row.project_secondary_unit,
    isCompanyParameter: row.is_company_parameter,
    submissionDate: row.submission_date,
    dueDeliveryDate: row.due_delivery_date,
    reservedDays: row.reserved_days,
    projectBiddingFile: toFileRef(row.project_bidding_file),
    projectCategory: row.project_category,
    screenshotRequirement: row.screenshot_requirement,
    assignedProjectManager: row.assigned_project_manager,
    completionStatus: row.completion_status,
    deliveryDocument: toFileRef(row.delivery_document),
    deliveryRemark: row.delivery_remark,
    isMeetScreenshotRequirement: row.is_meet_screenshot_requirement,
    salesFeedback: row.sales_feedback,
    attachments: toFileRefs(row.attachments),
    rectificationFeedback: row.rectification_feedback,
    rectifiedDocument: toFileRef(row.rectified_document),
    schoolId: row.school_id,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type {
  SchoolRow,
  DepartmentRow,
  ProjectRow,
  TaskRow,
  MemberRow,
  MilestoneRow,
  ActivityRow,
  TripRow,
  TripOptionDictRow,
  BiddingScreenshotRow,
  BiddingFileRefRow,
};
