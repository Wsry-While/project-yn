'use client';
import { useSyncExternalStore } from 'react';
import { apiFetch } from '@/lib/web/api-client';
import type { PermissionCode } from '@/lib/domain/rbac/types';

interface MePermissions {
  userId: string | null;
  puid: string | null;
  displayName: string;
  isSuperAdmin: boolean;
  roles: Array<{ code: string; name: string }>;
  permissions: string[];
  teamMemberId: string | null;
}

interface State {
  loaded: boolean;
  loading: boolean;
  data: MePermissions | null;
  error: string | null;
}

const listeners = new Set<() => void>();
let state: State = { loaded: false, loading: false, data: null, error: null };
let inflight: Promise<MePermissions> | null = null;

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return state;
}

export function ensurePermissions(): Promise<MePermissions> {
  if (state.data) return Promise.resolve(state.data);
  if (inflight) return inflight;
  setState({ loading: true });
  inflight = apiFetch<MePermissions>('/api/me/permissions')
    .then((data) => {
      setState({ loaded: true, loading: false, data, error: null });
      return data;
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : '权限加载失败';
      setState({ loaded: true, loading: false, error: msg });
      inflight = null;
      throw e;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function usePermissions() {
  const s = useSyncExternalStore(subscribe, getSnapshot, () => state);
  const perms = s.data ? new Set(s.data.permissions) : new Set<string>();
  return {
    loaded: s.loaded,
    loading: s.loading,
    error: s.error,
    data: s.data,
    isSuperAdmin: s.data?.isSuperAdmin ?? false,
    roles: s.data?.roles ?? [],
    can: (perm: PermissionCode | string): boolean => {
      if (!s.data) return false;
      if (s.data.isSuperAdmin) return true;
      return perms.has(perm as string);
    },
    canAny: (codes: Array<PermissionCode | string>): boolean => {
      if (!s.data) return false;
      if (s.data.isSuperAdmin) return true;
      return codes.some((c) => perms.has(c as string));
    },
    refresh: ensurePermissions,
  };
}

/** 启动时拉取权限，AppShell 挂载时调用 */
export function bootstrapPermissions() {
  if (typeof window === 'undefined') return;
  void ensurePermissions().catch(() => {
    // 未登录时接口 401，忽略
  });
}
