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

export type TripApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface TripRequest {
  id: string;
  projectId: string | null;
  schoolId: string | null;
  schoolName: string;
  department: string | null;
  industry: string | null;
  year: number | null;
  supportType: string;
  supportTypeOther: string | null;
  products: string[];
  detail: string | null;
  tripDate: string;
  startTime: string | null;
  endTime: string | null;
  weekday: string | null;
  salesManager: string | null;
  projectManager: string | null;
  initiator: string | null;
  initiatedAt: string | null;
  approvalStatus: TripApprovalStatus;
  isCompleted: string | null;
  reportConsistent: string | null;
  serviceSummary: string | null;
  salesLate: string | null;
  salesScore: number | null;
  serviceLate: string | null;
  overallScore: number | null;
  overallFeedback: string | null;
  derivedTaskId: string | null;
  externalId: string | null;
  externalSource: string | null;
  createdAt: string;
  updatedAt: string;
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
