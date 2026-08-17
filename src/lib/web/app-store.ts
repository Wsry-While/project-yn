'use client';
import { createStore } from '@/lib/web/store';
import type { Project } from '@/lib/domain/types';

interface AppState {
  /** 当前选中的项目；由 Sidebar/AppShell 初始化 */
  currentProject: Project | null;
  /** 当前登录用户 ID（来自 /api/auth/me） */
  currentUserId: string | null;
  /** 展示姓名（优先取超星可信资料） */
  currentUserDisplayName: string;
  /** 头像 URL（来自 user_metadata） */
  currentUserAvatarUrl: string;
  /** 学工号 */
  currentUserUid: string;
  /** 机构名称 */
  currentUserOrgName: string;
}

export const appStore = createStore<AppState>({
  currentProject: null,
  currentUserId: null,
  currentUserDisplayName: '',
  currentUserAvatarUrl: '',
  currentUserUid: '',
  currentUserOrgName: '',
});

export function setCurrentProject(project: Project | null): void {
  appStore.set({ currentProject: project });
}

export function setCurrentUser(user: {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  uid?: string;
  orgName?: string;
}): void {
  appStore.set({
    currentUserId: user.id,
    currentUserDisplayName: user.displayName,
    currentUserAvatarUrl: user.avatarUrl ?? '',
    currentUserUid: user.uid ?? '',
    currentUserOrgName: user.orgName ?? '',
  });
}
