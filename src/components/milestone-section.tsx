'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { milestoneWebService } from '@/lib/web/milestone-web-service';
import { showToast } from '@/lib/web/toast-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Milestone, TaskStatus } from '@/lib/domain/types';
import { TASK_STATUS_LABEL } from '@/lib/domain/types';

interface Props {
  projectId: string;
  canEdit: boolean;
}

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'review', 'done'];

function formatDate(iso: string | null): string {
  if (!iso) return '未设置';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('zh-CN');
}

export function MilestoneSection({ projectId, canEdit }: Props) {
  const [items, setItems] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await milestoneWebService.list(projectId));
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载里程碑失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.position - b.position),
    [items],
  );

  async function createMilestone(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      showToast('里程碑名称需在 2-100 字之间', { kind: 'error' });
      return;
    }
    setCreating(true);
    try {
      await milestoneWebService.create({
        projectId,
        name: trimmed,
        description: description.trim() || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        position: items.length + 1,
      });
      setName('');
      setDescription('');
      setDueDate('');
      await refresh();
      showToast('里程碑已创建', { kind: 'success' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建失败', { kind: 'error' });
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(milestone: Milestone, status: TaskStatus) {
    setSavingId(milestone.id);
    const previous = items;
    setItems((cur) => cur.map((m) => (m.id === milestone.id ? { ...m, status } : m)));
    try {
      const updated = await milestoneWebService.update(milestone.id, { status });
      setItems((cur) => cur.map((m) => (m.id === updated.id ? updated : m)));
    } catch (err) {
      setItems(previous);
      showToast(err instanceof Error ? err.message : '更新失败', { kind: 'error' });
    } finally {
      setSavingId(null);
    }
  }

  async function remove(milestone: Milestone) {
    if (!window.confirm(`确认删除里程碑「${milestone.name}」？任务不会被删除，但会解除关联。`)) return;
    setSavingId(milestone.id);
    try {
      await milestoneWebService.remove(milestone.id);
      setItems((cur) => cur.filter((m) => m.id !== milestone.id));
      showToast('里程碑已删除', { kind: 'info' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败', { kind: 'error' });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold">里程碑</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          按项目落地阶段推进；招投标、启明星建设和项目建设会在创建时自动生成默认阶段。
        </p>
      </div>

      <div className="space-y-3 p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载里程碑…
          </div>
        ) : sorted.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            暂无里程碑，先在下方新增一个关键阶段。
          </div>
        ) : (
          <ol className="space-y-2">
            {sorted.map((m, idx) => {
              const done = m.status === 'done';
              return (
                <li
                  key={m.id}
                  className="flex flex-col gap-3 rounded-md border border-border bg-background p-3 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {String(idx + 1).padStart(2, '0')}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="truncate text-sm font-medium">{m.name}</span>
                        <span
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-[10px]',
                            m.status === 'done'
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                              : m.status === 'in_progress'
                                ? 'border-brand/20 bg-brand/10 text-brand'
                                : 'border-border text-muted-foreground',
                          )}
                        >
                          {TASK_STATUS_LABEL[m.status]}
                        </span>
                      </div>
                      {m.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {m.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pl-8 sm:pl-0">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatDate(m.dueDate)}
                    </span>
                    <select
                      value={m.status}
                      disabled={!canEdit || savingId === m.id}
                      onChange={(e) => updateStatus(m, e.target.value as TaskStatus)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={savingId === m.id}
                        onClick={() => remove(m)}
                        aria-label={`删除里程碑 ${m.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {canEdit && (
          <form onSubmit={createMilestone} className="rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="新增里程碑，例如：合同签订"
                maxLength={100}
              />
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label="里程碑截止日期"
              />
              <Button type="submit" size="sm" disabled={creating}>
                <Plus className="h-3.5 w-3.5" />
                添加
              </Button>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="里程碑说明（可选）"
              rows={2}
              maxLength={1000}
              className="mt-3"
            />
          </form>
        )}
      </div>
    </section>
  );
}
