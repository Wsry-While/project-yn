/**
 * 领域对象与数据库行的映射，集中处理 snake_case → camelCase 转换。
 * 新增字段时，只改这里的三个 map 函数。
 */
import type { Project, ProjectSettings, Task, Member, ActivityLog } from '@/lib/domain/types';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  settings: ProjectSettings;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee_id: string | null;
  reporter_id: string | null;
  due_date: string | null;
  position: number;
  external_id: string | null;
  external_source: string | null;
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

interface ActivityRow {
  id: number;
  project_id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_title: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  notifications: {
    taskAssigned: true,
    taskCompleted: true,
    taskDueSoon: true,
    taskOverdue: true,
    projectUpdates: false,
    weeklyDigest: true,
  },
  workflow: {
    requireReview: false,
    allowExternalPush: false,
  },
};

export function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    status: row.status as Project['status'],
    startDate: row.start_date,
    endDate: row.end_date,
    settings: row.settings ?? DEFAULT_PROJECT_SETTINGS,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    assigneeId: row.assignee_id,
    reporterId: row.reporter_id,
    dueDate: row.due_date,
    position: row.position,
    externalId: row.external_id,
    externalSource: row.external_source,
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
    payload: row.payload,
    ip: row.ip,
    createdAt: row.created_at,
  };
}

export type { ProjectRow, TaskRow, MemberRow, ActivityRow };
