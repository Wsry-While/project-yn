'use client';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { appStore } from '@/lib/web/app-store';
import { taskWebService } from '@/lib/web/task-web-service';
import { projectWebService } from '@/lib/web/project-web-service';
import { showToast } from '@/lib/web/toast-store';
import { logActivity } from '@/lib/web/operation-logger';
import type { TaskPriority, TaskStatus, Member } from '@/lib/domain/types';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultStatus?: TaskStatus;
  onCreated?: () => void;
}

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'p0', label: 'P0 紧急' },
  { value: 'p1', label: 'P1 高' },
  { value: 'p2', label: 'P2 中' },
  { value: 'p3', label: 'P3 低' },
];

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: '待办' },
  { value: 'in_progress', label: '进行中' },
  { value: 'review', label: '审阅中' },
  { value: 'done', label: '已完成' },
];

/**
 * 全局「新建任务」抽屉。⌘N 唤起。
 * - 表单原生校验 + 简单长度校验
 * - 提交后调用 POST /api/tasks，写入活动日志
 */
export function NewTaskDrawer({ open, onClose, defaultStatus = 'todo', onCreated }: Props) {
  const project = appStore.use((s) => s.currentProject);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('p2');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [members, setMembers] = useState<Member[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && project) {
      setStatus(defaultStatus);
      setTitle('');
      setDescription('');
      setPriority('p2');
      setAssigneeId('');
      setDueDate('');
      setError(null);
      void projectWebService.team(project.id).then(setMembers).catch(() => setMembers([]));
    }
  }, [open, project, defaultStatus]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    const t = title.trim();
    if (t.length < 2) {
      setError('标题至少 2 个字符');
      return;
    }
    if (t.length > 200) {
      setError('标题不超过 200 个字符');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const task = await taskWebService.create({
        projectId: project.id,
        title: t,
        description: description.trim() || undefined,
        priority,
        status,
        assigneeId: assigneeId || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      });
      logActivity({
        projectId: project.id,
        action: 'task.create',
        entityType: 'task',
        entityId: task.id,
        entityTitle: task.title,
      });
      showToast('任务已创建', { kind: 'success' });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建任务"
      description="⌘N 快速创建；标题尽量简洁，详细方案可以放在描述里。"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="new-task-form" disabled={submitting || !project}>
            {submitting ? '创建中…' : '创建任务'}
          </Button>
        </>
      }
    >
      <form id="new-task-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="task-title" className="mb-1 block text-xs font-medium text-muted-foreground">
            标题
          </label>
          <input
            id="task-title"
            type="text"
            required
            minLength={2}
            maxLength={200}
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：完成看板交互原型"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div>
          <label
            htmlFor="task-desc"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            描述
          </label>
          <textarea
            id="task-desc"
            rows={3}
            value={description}
            maxLength={4000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="补充验收标准、依赖、链接……"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="task-status"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              状态
            </label>
            <select
              id="task-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="task-priority"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              优先级
            </label>
            <select
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="task-assignee"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              负责人
            </label>
            <select
              id="task-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">未指派</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName ?? m.userId.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="task-due"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              截止日期
            </label>
            <input
              id="task-due"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
