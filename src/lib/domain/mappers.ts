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
  project_id: string | null;
  school_id: string | null;
  school_name: string;
  department: string | null;
  industry: string | null;
  year: number | null;
  support_type: string;
  support_type_other: string | null;
  products: string[] | null;
  detail: string | null;
  trip_date: string;
  start_time: string | null;
  end_time: string | null;
  weekday: string | null;
  sales_manager: string | null;
  project_manager: string | null;
  initiator: string | null;
  initiated_at: string | null;
  approval_status: string;
  is_completed: string | null;
  report_consistent: string | null;
  service_summary: string | null;
  sales_late: string | null;
  sales_score: number | null;
  service_late: string | null;
  overall_score: number | null;
  overall_feedback: string | null;
  derived_task_id: string | null;
  external_id: string | null;
  external_source: string | null;
  external_uuid: string | null;
  external_operator: string | null;
  external_origin_operator: string | null;
  audit_status: number | null;
  deleted_at: string | null;
  raw_payload: Record<string, unknown> | null;
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
    projectId: row.project_id,
    schoolId: row.school_id,
    schoolName: row.school_name,
    department: row.department,
    industry: row.industry,
    year: row.year,
    supportType: row.support_type,
    supportTypeOther: row.support_type_other,
    products: row.products ?? [],
    detail: row.detail,
    tripDate: row.trip_date,
    startTime: row.start_time,
    endTime: row.end_time,
    weekday: row.weekday,
    salesManager: row.sales_manager,
    projectManager: row.project_manager,
    initiator: row.initiator,
    initiatedAt: row.initiated_at,
    approvalStatus: row.approval_status as TripRequest['approvalStatus'],
    isCompleted: row.is_completed,
    reportConsistent: row.report_consistent,
    serviceSummary: row.service_summary,
    salesLate: row.sales_late,
    salesScore: row.sales_score,
    serviceLate: row.service_late,
    overallScore: row.overall_score,
    overallFeedback: row.overall_feedback,
    derivedTaskId: row.derived_task_id,
    externalId: row.external_id,
    externalSource: row.external_source,
    externalUuid: row.external_uuid,
    externalOperator: row.external_operator,
    externalOriginOperator: row.external_origin_operator,
    auditStatus: row.audit_status,
    deletedAt: row.deleted_at,
    rawPayload: row.raw_payload,
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
};
