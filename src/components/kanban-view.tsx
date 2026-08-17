'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, AlertTriangle, Flag, Calendar, GripVertical, RefreshCw } from 'lucide-react';
import { appStore } from '@/lib/web/app-store';
import { taskWebService } from '@/lib/web/task-web-service';
import { projectWebService } from '@/lib/web/project-web-service';
import { milestoneWebService } from '@/lib/web/milestone-web-service';
import { showToast } from '@/lib/web/toast-store';
import { logActivity } from '@/lib/web/operation-logger';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Button } from '@/components/ui/button';
import { NewTaskDrawer } from '@/components/new-task-drawer';
import type { Task, TaskPriority, TaskStatus, Member, Milestone } from '@/lib/domain/types';
import { TASK_STATUS_LABEL, TASK_TYPE_LABEL } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'review', 'done'];

const PRIORITY_STYLE: Record<TaskPriority, { label: string; className: string }> = {
  p0: { label: 'P0', className: 'bg-red-500/10 text-red-500 border-red-500/20' },
  p1: { label: 'P1', className: 'bg-amber-500/10 text-amber-500 border-amber-500/20' },
  p2: { label: 'P2', className: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20' },
  p3: { label: 'P3', className: 'bg-zinc-500/5 text-zinc-400 border-zinc-500/10' },
};

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  todo: 'bg-zinc-400',
  in_progress: 'bg-brand',
  review: 'bg-amber-500',
  done: 'bg-emerald-500',
};

function formatDue(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const overdue = d.getTime() < now.getTime();
  return {
    text: d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
    overdue,
  };
}

interface TaskCardProps {
  task: Task;
  members: Member[];
  milestoneMap: Map<string, Milestone>;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onDragEnd: () => void;
  dragging: boolean;
}

function TaskCard({ task, members, milestoneMap, onDragStart, onDragEnd, dragging }: TaskCardProps) {
  const assignee = members.find((m) => m.userId === task.assigneeId);
  const due = formatDue(task.dueDate);
  const pStyle = PRIORITY_STYLE[task.priority];
  const milestone = task.milestoneId ? milestoneMap.get(task.milestoneId) : null;

  return (
    <article
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative cursor-grab rounded-md border border-border bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition active:cursor-grabbing',
        'hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_6px_18px_rgba(0,0,0,0.08)]',
        dragging && 'opacity-40',
      )}
      aria-label={`任务：${task.title}`}
    >
      <div className="flex items-start gap-2">
        <GripVertical
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h4 className="text-[13px] font-medium leading-snug text-foreground">{task.title}</h4>
          {task.description && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {task.description}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {task.taskType !== 'general' && (
              <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {TASK_TYPE_LABEL[task.taskType]}
              </span>
            )}
            {milestone && (
              <span className="inline-flex max-w-[140px] items-center truncate rounded border border-brand/20 bg-brand/5 px-1.5 py-0.5 text-[10px] text-brand">
                {milestone.name}
              </span>
            )}
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium',
                pStyle.className,
              )}
            >
              <Flag className="h-2.5 w-2.5" />
              {pStyle.label}
            </span>
            {due && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]',
                  due.overdue
                    ? 'border-red-500/30 bg-red-500/10 text-red-500'
                    : 'border-border text-muted-foreground',
                )}
              >
                <Calendar className="h-2.5 w-2.5" />
                {due.text}
                {due.overdue && <AlertTriangle className="h-2.5 w-2.5" />}
              </span>
            )}
            <span className="ml-auto inline-flex items-center">
              {assignee ? (
                <span
                  title={assignee.displayName ?? assignee.userId}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-brand to-zinc-600 text-[10px] font-medium text-white"
                >
                  {(assignee.displayName ?? '?').trim().charAt(0).toUpperCase()}
                </span>
              ) : (
                <span className="h-5 w-5 rounded-full border border-dashed border-border" />
              )}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

interface ColumnProps {
  status: TaskStatus;
  tasks: Task[];
  members: Member[];
  milestoneMap: Map<string, Milestone>;
  draggingTask: Task | null;
  onDragStart: (e: React.DragEvent, task: Task) => void;
  onDragEnd: () => void;
  onDrop: (status: TaskStatus, position: number) => void;
  onDragOverColumn: (status: TaskStatus) => void;
  isDropTarget: boolean;
}

function Column({
  status,
  tasks,
  members,
  milestoneMap,
  draggingTask,
  onDragStart,
  onDragEnd,
  onDrop,
  onDragOverColumn,
  isDropTarget,
}: ColumnProps) {
  const [over, setOver] = useState(false);

  return (
    <section
      aria-label={TASK_STATUS_LABEL[status]}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
        onDragOverColumn(status);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop(status, tasks.length + 1);
      }}
      className={cn(
        'flex min-h-0 flex-col rounded-lg border bg-muted/30 transition',
        over && isDropTarget ? 'border-brand ring-2 ring-brand/20' : 'border-border',
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', COLUMN_ACCENT[status])} aria-hidden />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            {TASK_STATUS_LABEL[status]}
          </h3>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {tasks.length}
          </span>
        </div>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-2 md:min-h-[400px]">
        {tasks.length === 0 ? (
          <button
            type="button"
            onClick={() => onDrop(status, 1)}
            className="flex h-20 w-full items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground transition hover:border-brand/40 hover:text-brand"
          >
            拖到这里，或点击新建
          </button>
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              members={members}
              milestoneMap={milestoneMap}
              dragging={draggingTask?.id === t.id}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function KanbanView() {
  const project = appStore.use((s) => s.currentProject);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [taskTypeFilter, setTaskTypeFilter] = useState<string>('all');
  const [milestoneFilter, setMilestoneFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>('todo');
  const [dragging, setDragging] = useState<Task | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const [ts, ms, mls] = await Promise.all([
        taskWebService.list(project.id),
        projectWebService.team(project.id),
        milestoneWebService.list(project.id).catch(() => [] as Milestone[]),
      ]);
      setTasks(ts);
      setMembers(ms);
      setMilestones(mls);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载任务失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const milestoneMap = useMemo(
    () => new Map(milestones.map((m) => [m.id, m])),
    [milestones],
  );

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (taskTypeFilter !== 'all' && t.taskType !== taskTypeFilter) return false;
      if (milestoneFilter === 'none' && t.milestoneId) return false;
      if (milestoneFilter !== 'all' && milestoneFilter !== 'none' && t.milestoneId !== milestoneFilter)
        return false;
      return true;
    });
  }, [tasks, taskTypeFilter, milestoneFilter]);

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], review: [], done: [] };
    for (const t of filteredTasks) map[t.status].push(t);
    for (const k of COLUMNS) {
      map[k].sort((a, b) => a.position - b.position);
    }
    return map;
  }, [filteredTasks]);

  const onDragStart = (e: React.DragEvent, task: Task) => {
    setDragging(task);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
  };
  const onDragEnd = () => {
    setDragging(null);
    setDropTarget(null);
  };
  const onDragOverColumn = (status: TaskStatus) => setDropTarget(status);

  const onDrop = async (targetStatus: TaskStatus, position: number) => {
    if (!dragging || !project) return;
    const source = dragging.status;
    if (source === targetStatus && position > grouped[targetStatus].length) {
      // no-op
      return;
    }
    // 乐观更新
    const previous = tasks;
    const moved: Task = { ...dragging, status: targetStatus, position };
    const next = tasks
      .map((t) =>
        t.id === moved.id
          ? moved
          : t.status === targetStatus && t.position >= position
            ? { ...t, position: t.position + 1 }
            : t,
      )
      .map((t) =>
        t.status === source && t.id !== moved.id && t.position > dragging.position
          ? { ...t, position: t.position - 1 }
          : t,
      );
    setTasks(next);

    try {
      const updated = await taskWebService.update(dragging.id, {
        status: targetStatus,
        position,
        version: dragging.version,
      });
      setTasks((cur) => cur.map((t) => (t.id === updated.id ? updated : t)));
      logActivity({
        projectId: project.id,
        action: `task.move.${targetStatus}`,
        entityType: 'task',
        entityId: updated.id,
        entityTitle: updated.title,
      });
      if (source !== targetStatus) {
        showToast(`已移动到「${TASK_STATUS_LABEL[targetStatus]}」`, { kind: 'success' });
      }
    } catch (err) {
      setTasks(previous);
      const msg = err instanceof Error ? err.message : '更新失败';
      showToast(msg, { kind: 'error', duration: 4500 });
    } finally {
      setDragging(null);
      setDropTarget(null);
    }
  };

  if (!project) {
    return (
      <div className="p-6 text-sm text-muted-foreground">尚未选择项目，请先创建或选择项目。</div>
    );
  }

  return (
    <LlmLoadingMask loading={loading} label="加载看板…" className="min-h-[70vh]">
      <div className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-[1400px] flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              kanban
            </div>
            <h1 className="text-xl font-semibold tracking-tight">任务看板</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={taskTypeFilter}
              onChange={(e) => setTaskTypeFilter(e.target.value)}
              aria-label="按工作类型筛选"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="all">全部工作类型</option>
              {Object.entries(TASK_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={milestoneFilter}
              onChange={(e) => setMilestoneFilter(e.target.value)}
              aria-label="按里程碑筛选"
              className="h-8 max-w-[180px] rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="all">全部里程碑</option>
              <option value="none">未关联里程碑</option>
              {[...milestones]
                .sort((a, b) => a.position - b.position)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <Button variant="secondary" size="sm" onClick={refresh} aria-label="刷新">
              <RefreshCw className="h-3.5 w-3.5" />
              刷新
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDefaultStatus('todo');
                setDrawerOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              新建任务
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={grouped[status]}
              members={members}
              milestoneMap={milestoneMap}
              draggingTask={dragging}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDrop={(s) => onDrop(s, grouped[s].length + 1)}
              onDragOverColumn={onDragOverColumn}
              isDropTarget={dropTarget === status}
            />
          ))}
        </div>
      </div>
      <NewTaskDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        defaultStatus={defaultStatus}
        onCreated={refresh}
      />
    </LlmLoadingMask>
  );
}
