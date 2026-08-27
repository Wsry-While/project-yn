'use client';
import * as React from 'react';
import { usePermissions } from '@/lib/web/use-permissions';
import type { PermissionCode } from '@/lib/domain/rbac/types';

interface CanProps {
  perm: PermissionCode | string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * 前端权限边界：有权限时渲染 children，否则渲染 fallback（默认 null）。
 * 用于按钮/操作列的显隐控制；真正的权限校验仍在服务端 requirePermission。
 */
export function Can({ perm, fallback = null, children }: CanProps) {
  const { can, loaded } = usePermissions();
  if (!loaded) return null;
  if (!can(perm)) return <>{fallback}</>;
  return <>{children}</>;
}
