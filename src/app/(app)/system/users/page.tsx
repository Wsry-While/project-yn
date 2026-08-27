'use client';
import { useCallback, useEffect, useState } from 'react';
import { Search, UserCog, Shield } from 'lucide-react';
import { PageContainer } from '@/components/crud/page-container';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/modal';
import { apiFetch } from '@/lib/web/api-client';
import { showToast } from '@/lib/web/toast-store';
import { usePermissions } from '@/lib/web/use-permissions';

interface UserRow {
  id: string;
  puid: string | null;
  name: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  bizRole: string | null;
  active: boolean;
  teamId: string | null;
  roles: Array<{ id: string; code: string; name: string; scope: string }>;
}

interface RoleOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
}

interface UsersResp {
  rows: UserRow[];
  total: number;
  page: number;
  pageSize: number;
}

const SCOPE_LABEL: Record<string, string> = {
  all: '全部数据',
  team: '本团队',
  self: '仅本人',
};

export default function SystemUsersPage() {
  const { can } = usePermissions();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<UserRow | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<'all' | 'team' | 'self'>('self');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiFetch<UsersResp>('/api/system/users', {
        query: { search, page, pageSize },
      });
      setRows(resp.rows);
      setTotal(resp.total);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '加载失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [search, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAssign = async (u: UserRow) => {
    setEditing(u);
    setSelected(u.roles.map((r) => r.id));
    setScope((u.roles[0]?.scope as 'all' | 'team' | 'self') ?? 'self');
    if (roles.length === 0) {
      try {
        const list = await apiFetch<RoleOption[]>('/api/system/roles');
        setRoles(list);
      } catch (e) {
        showToast(e instanceof Error ? e.message : '角色加载失败', { kind: 'error' });
      }
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await apiFetch(`/api/system/users/${editing.id}/roles`, {
        method: 'PATCH',
        body: JSON.stringify({ roleIds: selected, scope }),
      });
      showToast('角色已更新', { kind: 'success' });
      setEditing(null);
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败', { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const canManage = can('user:manage');

  return (
    <PageContainer
      title="用户管理"
      description="为团队成员分配系统角色（超级管理员 / 团队负责人 / 团队成员）"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative w-64 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="姓名 / puid 搜索"
            className="pl-8"
          />
        </div>
        <div className="ml-auto text-xs text-muted-foreground">共 {total} 人</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">成员</th>
              <th className="px-3 py-2 font-medium">PUID</th>
              <th className="px-3 py-2 font-medium">业务角色</th>
              <th className="px-3 py-2 font-medium">系统角色</th>
              <th className="px-3 py-2 font-medium">数据范围</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  加载中…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  暂无数据
                </td>
              </tr>
            )}
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-border/60 hover:bg-muted/50">
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">{u.displayName}</div>
                  <div className="text-xs text-muted-foreground">{u.email || u.phone || '-'}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {u.puid || '-'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{u.bizRole || '-'}</td>
                <td className="px-3 py-2">
                  {u.roles.length === 0 ? (
                    <span className="text-xs text-muted-foreground">未分配</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span
                          key={r.id}
                          className={
                            r.code === 'super_admin'
                              ? 'inline-flex items-center gap-1 rounded-sm bg-brand/10 px-1.5 py-0.5 text-xs text-brand'
                              : 'inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                          }
                        >
                          {r.code === 'super_admin' && <Shield className="h-3 w-3" />}
                          {r.name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {u.roles.length > 0 ? SCOPE_LABEL[u.roles[0].scope] ?? '-' : '-'}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      u.active
                        ? 'rounded-sm bg-status-success/10 px-1.5 py-0.5 text-xs text-status-success'
                        : 'rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground'
                    }
                  >
                    {u.active ? '启用' : '停用'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage ? (
                    <Button size="xs" variant="outline" onClick={() => openAssign(u)}>
                      <UserCog className="h-3 w-3" />
                      分配角色
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">无权限</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
        <span>
          第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页
        </span>
        <div className="flex gap-2">
          <Button
            size="xs"
            variant="outline"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={page >= Math.ceil(total / pageSize) || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`分配角色 - ${editing?.displayName ?? ''}`}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">系统角色</div>
            <div className="space-y-2">
              {roles.map((r) => {
                const checked = selected.includes(r.id);
                const isSuper = r.code === 'super_admin';
                return (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-brand"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) setSelected([...selected, r.id]);
                        else setSelected(selected.filter((x) => x !== r.id));
                      }}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        {r.name}
                        {isSuper && <Shield className="h-3 w-3 text-brand" />}
                      </div>
                      {r.description && (
                        <div className="text-xs text-muted-foreground">{r.description}</div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">数据范围</div>
            <div className="flex gap-2">
              {(['self', 'team', 'all'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={
                    'rounded-md border px-3 py-1.5 text-xs transition ' +
                    (scope === s
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border text-muted-foreground hover:bg-muted')
                  }
                >
                  {SCOPE_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </PageContainer>
  );
}
