/**
 * 核心领域类型定义 —— 项目中心
 *
 * 所有 API、数据库、前端共享同一份类型，避免散落多处的字符串字面量。
 */

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'p0' | 'p1' | 'p2' | 'p3';
export type ProjectStatus = 'active' | 'archived' | 'deleted';
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';

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

export interface Project {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  settings: ProjectSettings;
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

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  reporterId: string | null;
  dueDate: string | null;
  position: number;
  externalId: string | null;
  externalSource: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: number;
  projectId: string;
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

/**
 * 统一 API 返回体。所有 Route Handler 应返回 ApiResponse<T>。
 */
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown } };
