'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  MapPin,
  Plane,
  FileText,
  ClipboardList,
  Star,
  CalendarDays,
} from 'lucide-react';
import { apiFetch } from '@/lib/web/api-client';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Button } from '@/components/ui/button';
import type { School, SchoolDepartment } from '@/lib/domain/types';
import type { School360View } from '@/lib/domain/school-360-service';
import { cn } from '@/lib/utils';

const SOURCE_META: Record<
  School360View['timeline'][number]['source'],
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  trip: { label: '外出', icon: Plane, tone: 'text-sky-500' },
  bidding: { label: '招投标', icon: FileText, tone: 'text-violet-500' },
  demand: { label: '建设申请', icon: ClipboardList, tone: 'text-teal-500' },
  qiming: { label: '启明星', icon: Star, tone: 'text-amber-500' },
};

function CountCard({
  label,
  counts,
  icon: Icon,
  tone,
}: {
  label: string;
  counts: { total: number; open: number; year: number };
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <Icon className={cn('h-4 w-4', tone)} />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-semibold tabular-nums">{counts.total}</span>
        <span className="text-xs text-muted-foreground">条记录</span>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          <span className="font-mono text-foreground">{counts.open}</span> 未完成
        </span>
        <span>
          <span className="font-mono text-foreground">{counts.year}</span> 近 12 月
        </span>
      </div>
    </div>
  );
}

export default function School360Page() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [school, setSchool] = useState<(School & { departments: SchoolDepartment[] }) | null>(null);
  const [view, setView] = useState<School360View | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<School & { departments: SchoolDepartment[] }>(`/api/schools/${id}`),
      apiFetch<School360View>(`/api/schools/${id}/overview`),
    ])
      .then(([s, v]) => {
        if (cancelled) return;
        setSchool(s);
        setView(v);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <LlmLoadingMask loading={loading} label="加载学校档案…" className="min-h-[60vh]">
      <div className="mx-auto w-full max-w-6xl space-y-6 p-5 sm:p-8">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Button asChild size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
            <Link href="/schools">
              <ArrowLeft className="h-3.5 w-3.5" />
              返回学校列表
            </Link>
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500"
          >
            加载失败：{error}
          </div>
        )}

        {school && (
          <header className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand/10 text-brand">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">{school.name}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {school.industry && <span>行业 · {school.industry}</span>}
                    {school.level && <span>层级 · {school.level}</span>}
                    {school.province && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {school.province}
                      </span>
                    )}
                    <span>部门 · {school.departments.length}</span>
                  </div>
                </div>
              </div>
              <span className="rounded border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                学校 360°
              </span>
            </div>
          </header>
        )}

        {view && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CountCard
              label="项目外出"
              counts={view.counts.trips}
              icon={Plane}
              tone="text-sky-500"
            />
            <CountCard
              label="招投标截图"
              counts={view.counts.bidding}
              icon={FileText}
              tone="text-violet-500"
            />
            <CountCard
              label="项目建设申请"
              counts={view.counts.demands}
              icon={ClipboardList}
              tone="text-teal-500"
            />
            <CountCard
              label="启明星建设"
              counts={view.counts.qiming}
              icon={Star}
              tone="text-amber-500"
            />
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-card lg:col-span-2">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <CalendarDays className="h-4 w-4 text-brand" />
                业务时间线
              </h2>
              <span className="text-xs text-muted-foreground">最近 50 条</span>
            </header>
            <div className="divide-y divide-border">
              {(view?.timeline ?? []).length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                  该学校暂无业务记录
                </div>
              ) : (
                view?.timeline.map((it) => {
                  const meta = SOURCE_META[it.source];
                  const Icon = meta.icon;
                  return (
                    <Link
                      key={`${it.source}-${it.id}`}
                      href={it.url}
                      className={cn(
                        'flex items-start gap-3 px-5 py-3 text-sm transition hover:bg-muted/40',
                        it.isOpen && 'bg-amber-500/[0.03]',
                      )}
                    >
                      <div
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted',
                          meta.tone,
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            {meta.label}
                          </span>
                          <span className="truncate font-medium">{it.title.replace(/^[^·]+·\s*/, '')}</span>
                          {it.isOpen ? (
                            <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600">
                              未完成
                            </span>
                          ) : (
                            <span className="rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                              已完成
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {it.subtitle ?? '—'}
                          {it.status ? ` · ${it.status}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 font-mono text-xs text-muted-foreground">
                        {it.date ? it.date.slice(0, 10) : '—'}
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">对接部门</h2>
            </header>
            <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
              {(school?.departments ?? []).length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-muted-foreground">暂无部门档案</li>
              ) : (
                school?.departments.map((d) => (
                  <li key={d.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{d.name}</span>
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      <div>销售：{d.salesOwner ?? '—'}{d.salesTeam ? ` · ${d.salesTeam}` : ''}</div>
                      <div className="truncate font-mono text-[11px]">
                        {d.mobile ?? d.staffNo ?? '—'}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </section>
      </div>
    </LlmLoadingMask>
  );
}
