'use client';
import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/crud/page-container';
import { apiFetch } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { cn } from '@/lib/utils';

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_builtin: boolean;
}

interface Permission {
  id: string;
  code: string;
  name: string;
  module: string;
  action: string;
  description: string | null;
}

interface RolePermission {
  roleId: string;
  permissionId: string;
}

const MODULE_LABEL: Record<string, string> = {
  dashboard: '仪表盘',
  workbench: '我的工作台',
  risk: '风险中心',
  analytics: '多维分析',
  report: 'AI 周报',
  'data-align': '数据对齐',
  dict: '字典管理',
  team: '团队',
  school: '学校档案',
  project: '项目',
  task: '任务',
  milestone: '里程碑',
  trip: '项目外出',
  bidding: '招投标截图',
  demand: '建设申请',
  qiming: '启明星建设',
  user: '用户管理',
  role: '角色管理',
  permission: '权限管理',
  setting: '项目设置',
};

export default function SystemRolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [mapping, setMapping] = useState<Record<string, Set<string>>>({});
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [r, p] = await Promise.all([
          apiFetch<Role[]>('/api/system/roles'),
          apiFetch<Permission[]>('/api/system/permissions'),
        ]);
        setRoles(r);
        setPerms(p);
        if (r.length > 0) setActiveRole(r[0].id);
        // 拉取所有角色的权限映射
        const map: Record<string, Set<string>> = {};
        await Promise.all(
          r.map(async (role) => {
            try {
              const list = await apiFetch<RolePermission[]>(
                `/api/system/roles/${role.id}/permissions`,
              );
              map[role.id] = new Set(list.map((x) => x.permissionId));
            } catch {
              map[role.id] = new Set();
            }
          }),
        );
        setMapping(map);
      } catch (e) {
        showToast(e instanceof Error ? e.message : '加载失败', { kind: 'error' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 按 module 分组
  const groups = perms.reduce<Record<string, Permission[]>>((acc, p) => {
    (acc[p.module] ??= []).push(p);
    return acc;
  }, {});

  const activeSet = activeRole ? mapping[activeRole] : undefined;

  return (
    <PageContainer title="角色与权限" description="查看三个内置角色的权限点矩阵（只读）">
      <div className="grid grid-cols-1 gap-0 md:grid-cols-[220px_1fr]">
        <div className="border-b border-border p-2 md:border-b-0 md:border-r">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveRole(r.id)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition',
                activeRole === r.id
                  ? 'bg-brand/10 text-brand'
                  : 'text-foreground hover:bg-muted',
              )}
            >
              <span>{r.name}</span>
              {r.is_builtin && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  内置
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="p-4">
          {loading && <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>}
          {!loading && activeSet && (
            <div className="space-y-4">
              {Object.entries(groups).map(([mod, items]) => (
                <div key={mod}>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {MODULE_LABEL[mod] ?? mod}
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((p) => {
                      const on = activeSet.has(p.id);
                      return (
                        <div
                          key={p.id}
                          className={cn(
                            'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                            on
                              ? 'border-brand/30 bg-brand/5'
                              : 'border-border bg-card opacity-60',
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-sm border',
                              on
                                ? 'border-brand bg-brand text-brand-foreground'
                                : 'border-border bg-card',
                            )}
                          >
                            {on && (
                              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5">
                                <path
                                  d="M3.5 8.5l3 3 6-7"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground">{p.name}</div>
                            <div className="truncate font-mono text-[10px] text-muted-foreground">
                              {p.code}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
