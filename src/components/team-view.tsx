'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus, Mail, Trash2, ShieldCheck, UserCog, Loader2 } from 'lucide-react';
import { appStore } from '@/lib/web/app-store';
import { projectWebService } from '@/lib/web/project-web-service';
import { showToast } from '@/lib/web/toast-store';
import { logActivity } from '@/lib/web/operation-logger';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/modal';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { Member, MemberRole } from '@/lib/domain/types';
import { MEMBER_ROLE_LABEL } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const ROLE_BADGE: Record<MemberRole, string> = {
  owner: 'bg-brand/10 text-brand border-brand/20',
  admin: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  member: 'bg-zinc-500/10 text-muted-foreground border-border',
  viewer: 'bg-zinc-500/5 text-muted-foreground border-border/70',
};

export function TeamView() {
  const project = appStore.use((s) => s.currentProject);
  const userId = appStore.use((s) => s.currentUserId);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    userId: '',
    displayName: '',
    title: '',
    role: 'member' as MemberRole,
  });

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const ms = await projectWebService.team(project.id);
      setMembers(ms);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载成员失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canManage = useMemo(() => {
    if (!project || !userId) return false;
    const me = members.find((m) => m.userId === userId);
    return project.ownerId === userId || me?.role === 'admin';
  }, [project, userId, members]);

  const onInvite = async () => {
    if (!project) return;
    const userId = form.userId.trim();
    if (!userId || !/^[A-Za-z0-9@._-]{3,120}$/.test(userId)) {
      showToast('请输入合法的用户标识（邮箱或工号）', { kind: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch('/api/team?projectId=' + encodeURIComponent(project.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId,
          displayName: form.displayName.trim() || null,
          title: form.title.trim() || null,
          role: form.role,
        }),
      });
      const json = (await resp.json()) as { ok: boolean; data?: Member; error?: string };
      if (!resp.ok || !json.ok || !json.data) {
        throw new Error(json.error || '邀请失败');
      }
      setMembers((cur) => {
        const i = cur.findIndex((m) => m.userId === userId);
        if (i >= 0) {
          const cp = cur.slice();
          cp[i] = json.data as Member;
          return cp;
        }
        return [json.data as Member, ...cur];
      });
      logActivity({
        projectId: project.id,
        action: 'team.invite',
        entityType: 'member',
        entityId: userId,
        entityTitle: form.displayName.trim() || userId,
      });
      showToast(`已添加成员：${form.displayName.trim() || userId}`, { kind: 'success' });
      setInviteOpen(false);
      setForm({ userId: '', displayName: '', title: '', role: 'member' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '邀请失败', { kind: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const onRemove = async (m: Member) => {
    if (!project) return;
    try {
      const resp = await fetch(
        `/api/team?projectId=${encodeURIComponent(project.id)}&userId=${encodeURIComponent(m.userId)}`,
        { method: 'DELETE' },
      );
      const json = (await resp.json()) as { ok: boolean; error?: string };
      if (!resp.ok || !json.ok) throw new Error(json.error || '移除失败');
      setMembers((cur) => cur.filter((x) => x.userId !== m.userId));
      logActivity({
        projectId: project.id,
        action: 'team.remove',
        entityType: 'member',
        entityId: m.userId,
        entityTitle: m.displayName ?? m.userId,
      });
      showToast(`已移除 ${m.displayName ?? m.userId}`, { kind: 'info' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '移除失败', { kind: 'error' });
    } finally {
      setRemoving(null);
    }
  };

  if (!project) {
    return <div className="p-6 text-sm text-muted-foreground">尚未选择项目。</div>;
  }

  return (
    <LlmLoadingMask loading={loading} label="加载团队…" className="min-h-[70vh]">
      <div className="w-full p-4 sm:p-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              team
            </div>
            <h1 className="text-xl font-semibold tracking-tight">团队管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              当前项目共 {members.length} 名成员。
            </p>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" />
              邀请成员
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {members.map((m) => {
            const initial = (m.displayName ?? m.userId).trim().charAt(0).toUpperCase();
            const isMe = m.userId === userId;
            const isOwner = m.role === 'owner';
            return (
              <article
                key={m.userId}
                className="group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
              >
                <div className="relative">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand to-zinc-600 text-sm font-semibold text-white"
                    aria-hidden
                  >
                    {initial}
                  </div>
                  {isOwner && (
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5 text-brand">
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-medium">
                      {m.displayName ?? m.userId}
                    </h3>
                    {isMe && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        我
                      </span>
                    )}
                  </div>
                  {m.title && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.title}</p>
                  )}
                  <p className="mt-1 flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
                    <Mail className="h-3 w-3" />
                    {m.userId}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
                        ROLE_BADGE[m.role],
                      )}
                    >
                      {m.role === 'owner' ? (
                        <ShieldCheck className="h-3 w-3" />
                      ) : m.role === 'admin' ? (
                        <UserCog className="h-3 w-3" />
                      ) : null}
                      {MEMBER_ROLE_LABEL[m.role]}
                    </span>
                    {canManage && !isOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-red-500"
                        onClick={() => setRemoving(m)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <Modal
        open={inviteOpen}
        onClose={() => !submitting && setInviteOpen(false)}
        title="邀请成员"
        description="输入成员的超星账号或工号，并设置其在本项目中的角色。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={onInvite} disabled={submitting}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              添加
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-user">账号 / 工号</Label>
            <Input
              id="invite-user"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
              placeholder="例如：zhangsan 或 user@org.cn"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">显示名（可选）</Label>
            <Input
              id="invite-name"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              maxLength={40}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-title">职位（可选）</Label>
            <Input
              id="invite-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">角色</Label>
            <select
              id="invite-role"
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value as MemberRole })
              }
              className="flex h-9 w-full rounded-md border border-border bg-input px-3 text-sm shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removing}
        title="移除成员"
        description={
          removing
            ? `确认将「${removing.displayName ?? removing.userId}」移出本项目？该操作可被重新邀请恢复。`
            : ''
        }
        confirmText="移除"
        tone="danger"
        onConfirm={() => removing && onRemove(removing)}
        onCancel={() => setRemoving(null)}
      />
    </LlmLoadingMask>
  );
}
