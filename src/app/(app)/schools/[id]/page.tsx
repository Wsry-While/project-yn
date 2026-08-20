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
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  trip: { label: '外出', icon: Plane },
  bidding: { label: '招投标', icon: FileText },
  demand: { label: '建设申请', icon: ClipboardList },
  qiming: { label: '启明星', icon: Star },
};

function CountCard({
  label,
  counts,
  icon: Icon,
}: {
  label: string;
  counts: { total: number; open: number; year: number };
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3 transition-colors hover:border-border/80">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {counts.total}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>未完成 <span className="font-mono text-foreground/70">{counts.open}</span></span>
        <span className="text-border">·</span>
        <span>12 月内 <span className="font-mono text-foreground/70">{counts.year}</span></span>
      </div>
    </div>
  );
}

function formatTitle(raw: string): { source: string; rest: string } {
  const idx = raw.indexOf(' · ');
  if (idx === -1) return { source: '', rest: raw };
  return { source: raw.slice(0, idx), rest: raw.slice(idx + 3) };
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

  const totalRecords = view
    ? view.counts.trips.total +
      view.counts.bidding.total +
      view.counts.demands.total +
      view.counts.qiming.total
    : 0;

  return (
    <LlmLoadingMask loading={loading} label="加载学校档案…" className="min-h-[60vh]">
      <div className="mx-auto w-full max-w-6xl space-y-5 p-5 sm:p-6">
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
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold tracking-tight">{school.name}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {school.industry && <span>{school.industry}</span>}
                    {school.level && (
                      <>
                        <span className="text-border">·</span>
                        <span>{school.level}</span>
                      </>
                    )}
                    {school.province && (
                      <>
                        <span className="text-border">·</span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {school.province}
                        </span>
                      </>
                    )}
                    <span className="text-border">·</span>
                    <span>{school.departments.length} 个对接部门</span>
                  </div>
                </div>
              </div>
              <span className="rounded border border-border bg-muted px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                360°
              </span>
            </div>
          </header>
        )}

        {view && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CountCard label="项目外出" counts={view.counts.trips} icon={Plane} />
            <CountCard label="招投标" counts={view.counts.bidding} icon={FileText} />
            <CountCard label="建设申请" counts={view.counts.demands} icon={ClipboardList} />
            <CountCard label="启明星" counts={view.counts.qiming} icon={Star} />
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-border bg-card lg:col-span-2">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <CalendarDays className="h-4 w-4 text-brand" />
                业务时间线
              </h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                {totalRecords} 条记录 · 显示最近 {(view?.timeline ?? []).length}
              </span>
            </header>
            <div>
              {(view?.timeline ?? []).length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                  该学校暂无业务记录
                </div>
              ) : (
                <ol className="relative">
                  {view?.timeline.map((it, idx) => {
                    const meta = SOURCE_META[it.source];
                    const { rest } = formatTitle(it.title);
                    const isLast = idx === view.timeline.length - 1;
                    return (
                      <li key={`${it.source}-${it.id}`} className="relative">
                        {!isLast && (
                          <span
                            aria-hidden
                            className="absolute left-[22px] top-8 h-[calc(100%-1.5rem)] w-px bg-border"
                          />
                        )}
                        <Link
                          href={it.url}
                          className="flex items-start gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-muted/40"
                        >
                          <span
                            className={cn(
                              'relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-card',
                              it.isOpen ? 'border-amber-500/40 text-amber-500' : 'border-border text-muted-foreground/70',
                            )}
                          >
                            <meta.icon className="h-3 w-3" />
                          </span>
                          <div className="min-w-0 flex-1 py-0.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="truncate text-[13px] font-medium text-foreground/90">
                                {rest}
                              </span>
                              <span className="rounded bg-muted px-1 py-px font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                                {meta.label}
                              </span>
                              {it.isOpen ? (
                                <span className="font-mono text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-500">
                                  未完成
                                </span>
                              ) : (
                                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                                  已完成
                                </span>
                              )}
                            </div>
                            {(it.subtitle || it.status) && (
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {[it.subtitle, it.status].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                            {it.date ? it.date.slice(0, 10) : '—'}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">对接部门</h2>
            </header>
            <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
              {(school?.departments ?? []).length === 0 ? (
                <li className="px-5 py-10 text-center text-sm text-muted-foreground">暂无部门档案</li>
              ) : (
                school?.departments.map((d) => (
                  <li key={d.id} className="px-5 py-3 text-sm">
                    <div className="text-[13px] font-medium text-foreground/90">{d.name}</div>
                    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      <div>
                        销售：{d.salesOwner ?? '—'}
                        {d.salesTeam ? <span className="text-border"> · </span> : null}
                        {d.salesTeam}
                      </div>
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
