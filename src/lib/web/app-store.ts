'use client';
import { createStore } from '@/lib/web/store';
import type { Project } from '@/lib/domain/types';

interface AppState {
  /** 当前选中的项目；由 Sidebar/AppShell 初始化 */
  currentProject: Project | null;
  /** 当前用户（来自 /api/auth/me 的简化信息） */
  currentUserId: string | null;
  currentUserDisplayName: string;
}

export const appStore = createStore<AppState>({
  currentProject: null,
  currentUserId: null,
  currentUserDisplayName: '',
});

export function setCurrentProject(project: Project | null): void {
  appStore.set({ currentProject: project });
}

export function setCurrentUser(user: { id: string; displayName: string }): void {
  appStore.set({
    currentUserId: user.id,
    currentUserDisplayName: user.displayName,
  });
}
