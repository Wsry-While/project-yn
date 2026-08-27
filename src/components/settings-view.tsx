'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { appStore } from '@/lib/web/app-store';
import { projectWebService } from '@/lib/web/project-web-service';
import { schoolWebService } from '@/lib/web/school-web-service';
import { showToast } from '@/lib/web/toast-store';
import { logActivity } from '@/lib/web/operation-logger';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MilestoneSection } from '@/components/milestone-section';
import { KnowledgeBaseAdmin } from '@/components/knowledge-base-admin';
import { usePermissions } from '@/lib/web/use-permissions';
import type { ProjectSettings, ProjectType, SchoolWithDepartments } from '@/lib/domain/types';
import { PROJECT_TYPE_LABEL } from '@/lib/domain/types';

interface FormState {
  name: string;
  description: string;
  projectType: ProjectType;
  schoolId: string;
  departmentId: string;
  industry: string;
  products: string[];
  startDate: string;
  endDate: string;
  settings: ProjectSettings;
}

const PRODUCT_OPTIONS = [
  '泛雅智慧课程平台',
  '启明星',
  'AI知识库相关',
  '考试系统',
  '资源库',
  '督导评价系统',
  '智播课堂',
  '教师发展平台',
  '课程思政平台',
  '实习实训平台',
  '虚拟教研室',
  '教科研平台',
  '大赛平台',
  '学工',
  '图书馆',
  '继教',
  '实验室安全管理系统',
  '其他',
];

const DEFAULT_SETTINGS: ProjectSettings = {
  notifications: {
    taskAssigned: true,
    taskCompleted: true,
    taskDueSoon: true,
    taskOverdue: true,
    projectUpdates: false,
    weeklyDigest: false,
  },
  workflow: {
    requireReview: false,
    allowExternalPush: false,
  },
};

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function SettingsView() {
  const router = useRouter();
  const project = appStore.use((s) => s.currentProject);
  const userId = appStore.use((s) => s.currentUserId);
  const [form, setForm] = useState<FormState | null>(null);
  const [schools, setSchools] = useState<SchoolWithDepartments[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isOwner = useMemo(() => !!project && !!userId && project.ownerId === userId, [project, userId]);
  const { isSuperAdmin } = usePermissions();

  useEffect(() => {
    schoolWebService.list({ limit: 500 }).then(setSchools).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!project) return;
    setForm({
      name: project.name,
      description: project.description ?? '',
      projectType: project.projectType,
      schoolId: project.schoolId ?? '',
      departmentId: project.departmentId ?? '',
      industry: project.industry ?? '教务（本科）',
      products: project.products ?? [],
      startDate: toDateInput(project.startDate),
      endDate: toDateInput(project.endDate),
      settings: {
        notifications: { ...DEFAULT_SETTINGS.notifications, ...(project.settings.notifications ?? {}) },
        workflow: { ...DEFAULT_SETTINGS.workflow, ...(project.settings.workflow ?? {}) },
      },
    });
  }, [project]);

  const save = useCallback(async () => {
    if (!project || !form) return;
    const name = form.name.trim();
    if (name.length < 2 || name.length > 80) {
      showToast('项目名称长度需在 2-80 字之间', { kind: 'error' });
      return;
    }
    if (form.description.length > 2000) {
      showToast('项目描述不能超过 2000 字', { kind: 'error' });
      return;
    }
    if (form.startDate && form.endDate && form.startDate > form.endDate) {
      showToast('开始日期不能晚于结束日期', { kind: 'error' });
      return;
    }
    setSaving(true);
    try {
      const updated = await projectWebService.update(project.id, {
        name,
        description: form.description.trim() || null,
        projectType: form.projectType,
        schoolId: form.schoolId || null,
        departmentId: form.departmentId || null,
        industry: form.industry || null,
        products: form.products,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        settings: form.settings,
      });
      appStore.set((s) => ({ ...s, currentProject: updated }));
      logActivity({
        projectId: project.id,
        action: 'project.settings.update',
        entityType: 'project',
        entityId: project.id,
        entityTitle: updated.name,
      });
      showToast('设置已保存', { kind: 'success' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', { kind: 'error' });
    } finally {
      setSaving(false);
    }
  }, [project, form]);

  const remove = useCallback(async () => {
    if (!project) return;
    setDeleting(true);
    try {
      await projectWebService.remove(project.id);
      logActivity({
        projectId: project.id,
        action: 'project.delete',
        entityType: 'project',
        entityId: project.id,
        entityTitle: project.name,
      });
      showToast('项目已归档', { kind: 'info' });
      appStore.set({ currentProject: null });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败', { kind: 'error' });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [project, router]);

  if (!project || !form) {
    return <LlmLoadingMask loading label="加载设置…" className="min-h-[70vh]" />;
  }

  return (
    <LlmLoadingMask loading={loading} label="加载设置…" className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-8">
        <header>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            settings
          </div>
          <h1 className="text-xl font-semibold tracking-tight">项目设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理项目基本信息、通知偏好和工作流选项。
          </p>
        </header>

        {/* 基本信息 */}
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">基本信息</h2>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="project-type">项目类型</Label>
                <select
                  id="project-type"
                  value={form.projectType}
                  disabled={!isOwner}
                  onChange={(e) =>
                    setForm({ ...form, projectType: e.target.value as ProjectType })
                  }
                  className="flex h-9 w-full rounded-md border border-border bg-input px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
                >
                  {(Object.keys(PROJECT_TYPE_LABEL) as ProjectType[]).map((t) => (
                    <option key={t} value={t}>
                      {PROJECT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-industry">所属行业</Label>
                <Input
                  id="project-industry"
                  value={form.industry}
                  disabled={!isOwner}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="project-school">关联学校</Label>
                <select
                  id="project-school"
                  value={form.schoolId}
                  disabled={!isOwner}
                  onChange={(e) => setForm({ ...form, schoolId: e.target.value, departmentId: '' })}
                  className="flex h-9 w-full rounded-md border border-border bg-input px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
                >
                  <option value="">不关联</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-department">关联部门</Label>
                <select
                  id="project-department"
                  value={form.departmentId}
                  disabled={!isOwner || !form.schoolId}
                  onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-border bg-input px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
                >
                  <option value="">不指定</option>
                  {schools
                    .find((s) => s.id === form.schoolId)
                    ?.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.salesOwner ? `（${d.salesOwner}）` : ''}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>所属产品</Label>
              <div className="flex flex-wrap gap-1.5 rounded-md border border-border p-2">
                {PRODUCT_OPTIONS.map((p) => {
                  const on = form.products.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={!isOwner}
                      onClick={() =>
                        setForm({
                          ...form,
                          products: on
                            ? form.products.filter((x) => x !== p)
                            : [...form.products, p],
                        })
                      }
                      className={
                        'rounded border px-2 py-0.5 text-xs transition disabled:opacity-50 ' +
                        (on
                          ? 'border-brand bg-brand/10 text-brand'
                          : 'border-border text-muted-foreground hover:text-foreground')
                      }
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-name">项目名称</Label>
              <Input
                id="project-name"
                value={form.name}
                maxLength={80}
                disabled={!isOwner}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{form.name.length}/80</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-desc">项目描述</Label>
              <Textarea
                id="project-desc"
                rows={4}
                value={form.description}
                maxLength={2000}
                disabled={!isOwner}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{form.description.length}/2000</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="start-date">开始日期</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={form.startDate}
                  disabled={!isOwner}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-date">结束日期</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={form.endDate}
                  disabled={!isOwner}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
          </div>
        </section>

        <MilestoneSection projectId={project.id} canEdit={isOwner} />

        {/* 通知偏好 */}
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">通知偏好</h2>
          </div>
          <div className="divide-y divide-border">
            {(
              [
                { key: 'taskAssigned', title: '任务分配', desc: '当你被指派任务时发送通知。' },
                { key: 'taskDueSoon', title: '即将到期提醒', desc: '任务截止前 24 小时提醒。' },
                { key: 'taskOverdue', title: '逾期提醒', desc: '任务逾期后立即提醒。' },
                { key: 'weeklyDigest', title: '每周项目摘要', desc: '每周一上午汇总上周进展。' },
              ] as const
            ).map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div>
                  <div className="text-sm font-medium">{row.title}</div>
                  <div className="text-xs text-muted-foreground">{row.desc}</div>
                </div>
                <Switch
                  checked={form.settings.notifications[row.key]}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      settings: {
                        ...form.settings,
                        notifications: { ...form.settings.notifications, [row.key]: v },
                      },
                    })
                  }
                  aria-label={row.title}
                />
              </div>
            ))}
          </div>
        </section>

        {/* 工作流 */}
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">工作流</h2>
          </div>
          <div className="divide-y divide-border">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <div className="text-sm font-medium">任务必须经过审阅</div>
                <div className="text-xs text-muted-foreground">
                  开启后任务完成前需经由「审阅中」状态。
                </div>
              </div>
              <Switch
                checked={form.settings.workflow.requireReview}
                disabled={!isOwner}
                onChange={(v) =>
                  setForm({
                    ...form,
                    settings: {
                      ...form.settings,
                      workflow: { ...form.settings.workflow, requireReview: v },
                    },
                  })
                }
                aria-label="任务必须经过审阅"
              />
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <div className="text-sm font-medium">允许第三方系统推送任务</div>
                <div className="text-xs text-muted-foreground">
                  通过 HTTP 接口接收外部系统推送的任务数据。
                </div>
              </div>
              <Switch
                checked={form.settings.workflow.allowExternalPush}
                disabled={!isOwner}
                onChange={(v) =>
                  setForm({
                    ...form,
                    settings: {
                      ...form.settings,
                      workflow: { ...form.settings.workflow, allowExternalPush: v },
                    },
                  })
                }
                aria-label="允许第三方系统推送任务"
              />
            </div>
          </div>
        </section>

        {!isOwner && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-600 dark:text-amber-400">
            你不是该项目所有者，部分设置仅可查看。
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || !isOwner}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存更改
          </Button>
        </div>

        {/* 截图知识库（仅超管） */}
        {isSuperAdmin && <KnowledgeBaseAdmin />}

        {/* 危险操作 */}
        {isOwner && (
          <section className="rounded-lg border border-red-500/30 bg-red-500/[0.03]">
            <div className="border-b border-red-500/20 px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-red-600 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                危险操作
              </h2>
            </div>
            <div className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
              <div>
                <div className="text-sm font-medium">归档项目</div>
                <div className="text-xs text-muted-foreground">
                  归档后项目在列表中隐藏，可由管理员恢复。
                </div>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                归档项目
              </Button>
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="归档项目"
        tone="danger"
        confirmText={deleting ? '归档中…' : '确认归档'}
        description={`确认归档「${project.name}」？归档后看板、任务和团队数据将被保留，但项目不再出现在默认列表中。`}
        onConfirm={remove}
        onCancel={() => !deleting && setConfirmDelete(false)}
        inFlight={deleting}
      />
    </LlmLoadingMask>
  );
}
