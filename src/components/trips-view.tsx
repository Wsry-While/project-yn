'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  MapPin,
  Calendar,
  Plus,
  Plane,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { tripWebService } from '@/lib/web/trip-web-service';
import { schoolWebService } from '@/lib/web/school-web-service';
import { showToast } from '@/lib/web/toast-store';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Modal } from '@/components/modal';
import type { SchoolWithDepartments, TripRequest } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const SUPPORT_TYPES = [
  '售前汇报',
  '使用培训',
  '需求沟通',
  '现场投标',
  '项目验收',
  '项目启动会',
  '其他',
];

const PRODUCTS = [
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

const APPROVAL_META: Record<
  TripRequest['approvalStatus'],
  { label: string; className: string; icon: typeof Clock }
> = {
  approved: { label: '已通过', className: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  rejected: { label: '已拒绝', className: 'text-red-500 bg-red-500/10 border-red-500/20', icon: XCircle },
  pending: { label: '待审批', className: 'text-amber-500 bg-amber-500/10 border-amber-500/20', icon: Clock },
};

function weekdayOf(dateStr: string): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(dateStr).getDay()] ?? '';
}

export function TripsView() {
  const [trips, setTrips] = useState<TripRequest[]>([]);
  const [schools, setSchools] = useState<SchoolWithDepartments[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filterType, setFilterType] = useState<string>('');
  const [q, setQ] = useState('');

  const [form, setForm] = useState({
    schoolId: '',
    department: '',
    industry: '教务（本科）',
    supportType: '需求沟通',
    supportTypeOther: '',
    products: [] as string[],
    detail: '',
    tripDate: new Date().toISOString().slice(0, 10),
    startTime: '09:00',
    endTime: '12:00',
    salesManager: '',
    projectManager: '',
  });

  const refresh = () => {
    setLoading(true);
    Promise.all([tripWebService.list({ limit: 200 }), schoolWebService.list({ limit: 500 })])
      .then(([ts, ss]) => {
        setTrips(ts);
        setSchools(ss);
      })
      .catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : '加载外出申请失败', { kind: 'error' });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const schoolMap = useMemo(() => {
    const m = new Map<string, SchoolWithDepartments>();
    schools.forEach((s) => m.set(s.id, s));
    return m;
  }, [schools]);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return trips.filter((t) => {
      if (filterType && t.supportType !== filterType) return false;
      if (!k) return true;
      return (
        t.schoolName.toLowerCase().includes(k) ||
        (t.department ?? '').toLowerCase().includes(k) ||
        (t.salesManager ?? '').toLowerCase().includes(k) ||
        (t.detail ?? '').toLowerCase().includes(k)
      );
    });
  }, [trips, q, filterType]);

  const selectedSchool = schoolMap.get(form.schoolId);

  const toggleProduct = (p: string) => {
    setForm((f) => ({
      ...f,
      products: f.products.includes(p) ? f.products.filter((x) => x !== p) : [...f.products, p],
    }));
  };

  const submit = async () => {
    if (!form.schoolId) {
      showToast('请选择学校', { kind: 'error' });
      return;
    }
    if (!form.detail.trim()) {
      showToast('请填写具体事宜', { kind: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const school = schoolMap.get(form.schoolId);
      if (!school) throw new Error('请选择学校');
      await tripWebService.create({
        schoolId: school.id,
        schoolName: school.name,
        department: form.department || null,
        industry: form.industry,
        supportType: form.supportType,
        supportTypeOther: form.supportType === '其他' ? form.supportTypeOther : null,
        products: form.products,
        detail: form.detail.trim(),
        tripDate: form.tripDate,
        startTime: form.startTime,
        endTime: form.endTime,
        salesManager: form.salesManager || null,
        projectManager: form.projectManager || null,
      });
      showToast('外出申请已创建', { kind: 'success' });
      setOpen(false);
      setForm({
        ...form,
        detail: '',
        supportTypeOther: '',
        products: [],
      });
      refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '创建失败', { kind: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LlmLoadingMask loading={loading} label="加载外出申请…" className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              field service
            </div>
            <h1 className="text-xl font-semibold tracking-tight">项目外出</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {trips.length} 条外出记录，本月{' '}
              {
                trips.filter((t) => t.tripDate?.slice(0, 7) === new Date().toISOString().slice(0, 7))
                  .length
              } 条。
            </p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            发起外出申请
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索学校、销售、事宜"
            className="h-8 max-w-xs text-sm"
          />
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setFilterType('')}
              className={cn(
                'rounded-md border px-2 py-1 text-xs transition',
                !filterType
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              全部
            </button>
            {SUPPORT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs transition',
                  filterType === t
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => {
            const meta = APPROVAL_META[t.approvalStatus];
            const Icon = meta.icon;
            return (
              <article
                key={t.id}
                className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{t.schoolName}</h3>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {t.department ?? '—'}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
                      meta.className,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                    <Plane className="h-3 w-3" />
                    {t.supportType}
                    {t.supportType === '其他' && t.supportTypeOther ? `：${t.supportTypeOther}` : ''}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {t.tripDate}
                    {t.startTime ? ` ${t.startTime}` : ''}
                    {t.endTime ? `–${t.endTime}` : ''}
                    {t.weekday ? ` ${t.weekday}` : ` ${weekdayOf(t.tripDate)}`}
                  </span>
                </div>

                <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                  {t.detail ?? '—'}
                </p>

                {t.products.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.products.slice(0, 4).map((p) => (
                      <span
                        key={p}
                        className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {p}
                      </span>
                    ))}
                    {t.products.length > 4 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{t.products.length - 4}
                      </span>
                    )}
                  </div>
                )}

                <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {t.salesManager ?? '未指派销售'}
                  </span>
                  {t.overallScore != null && <span>综合评分 {t.overallScore}</span>}
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && !loading && (
            <div className="col-span-full rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              暂无外出申请记录
            </div>
          )}
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => !submitting && setOpen(false)}
        title="发起项目外出申请"
        description="字段对齐《项目外出申请》导入模板。提交后可在第三方系统中继续走审批流程。"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              提交申请
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="trip-school">学校 *</Label>
            <select
              id="trip-school"
              value={form.schoolId}
              onChange={(e) => setForm({ ...form, schoolId: e.target.value })}
              className="flex h-9 w-full rounded-md border border-border bg-input px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option value="">请选择学校</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.departments.length} 个部门）
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trip-dept">部门</Label>
            <select
              id="trip-dept"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              disabled={!selectedSchool}
              className="flex h-9 w-full rounded-md border border-border bg-input px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-50"
            >
              <option value="">不指定</option>
              {selectedSchool?.departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                  {d.salesOwner ? `（${d.salesOwner}）` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trip-industry">所属行业</Label>
            <select
              id="trip-industry"
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
              className="flex h-9 w-full rounded-md border border-border bg-input px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              <option>教务（本科）</option>
              <option>教务（职教）</option>
              <option>课程定制智能体、售前课程咨询、工作坊等（杨丽萍组）</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trip-type">外出支持类型 *</Label>
            <select
              id="trip-type"
              value={form.supportType}
              onChange={(e) => setForm({ ...form, supportType: e.target.value })}
              className="flex h-9 w-full rounded-md border border-border bg-input px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            >
              {SUPPORT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          {form.supportType === '其他' && (
            <div className="space-y-1.5">
              <Label htmlFor="trip-other">支持类型说明</Label>
              <Input
                id="trip-other"
                value={form.supportTypeOther}
                onChange={(e) => setForm({ ...form, supportTypeOther: e.target.value })}
                maxLength={100}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="trip-date">外出日期 *</Label>
            <Input
              id="trip-date"
              type="date"
              value={form.tripDate}
              onChange={(e) => setForm({ ...form, tripDate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trip-start">预计开始</Label>
            <Input
              id="trip-start"
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trip-end">预计结束</Label>
            <Input
              id="trip-end"
              type="time"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trip-sales">负责销售经理</Label>
            <Input
              id="trip-sales"
              value={form.salesManager}
              onChange={(e) => setForm({ ...form, salesManager: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trip-pm">指派项目经理</Label>
            <Input
              id="trip-pm"
              value={form.projectManager}
              onChange={(e) => setForm({ ...form, projectManager: e.target.value })}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>所属产品 *</Label>
            <div className="flex flex-wrap gap-1.5 rounded-md border border-border p-2">
              {PRODUCTS.map((p) => {
                const on = form.products.includes(p);
                return (
                  <button
                    type="button"
                    key={p}
                    onClick={() => toggleProduct(p)}
                    className={cn(
                      'rounded border px-2 py-0.5 text-xs transition',
                      on
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="trip-detail">具体事宜 *</Label>
            <Textarea
              id="trip-detail"
              rows={4}
              value={form.detail}
              onChange={(e) => setForm({ ...form, detail: e.target.value })}
              maxLength={10000}
              placeholder="描述本次外出目的、对接人、预期产出等"
            />
          </div>
        </div>
      </Modal>
    </LlmLoadingMask>
  );
}
