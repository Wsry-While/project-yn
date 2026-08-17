'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search, Building2, Users, MapPin, ChevronRight, Loader2 } from 'lucide-react';
import { schoolWebService } from '@/lib/web/school-web-service';
import { showToast } from '@/lib/web/toast-store';
import { LlmLoadingMask } from '@/components/llm-loading-mask';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { SchoolWithDepartments } from '@/lib/domain/types';

export function SchoolsView() {
  const [schools, setSchools] = useState<SchoolWithDepartments[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    setLoading(true);
    schoolWebService
      .list({ limit: 500 })
      .then((rows) => {
        if (abort) return;
        setSchools(rows);
        if (rows[0]) setActiveId(rows[0].id);
      })
      .catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : '加载学校失败', { kind: 'error' });
      })
      .finally(() => !abort && setLoading(false));
    return () => {
      abort = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return schools;
    return schools.filter(
      (s) =>
        s.name.toLowerCase().includes(k) ||
        s.departments.some(
          (d) =>
            d.name.toLowerCase().includes(k) ||
            (d.salesOwner ?? '').toLowerCase().includes(k) ||
            (d.salesTeam ?? '').toLowerCase().includes(k),
        ),
    );
  }, [schools, q]);

  const active = useMemo(
    () => filtered.find((s) => s.id === activeId) ?? filtered[0] ?? null,
    [filtered, activeId],
  );

  return (
    <LlmLoadingMask loading={loading} label="加载学校档案…" className="min-h-[70vh]">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-[360px_1fr]">
        <aside className="flex h-[calc(100vh-7rem)] flex-col rounded-lg border border-border bg-card">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索学校、部门、销售"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="mt-2 flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
              <span>共 {filtered.length} 所学校</span>
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {filtered.map((s) => {
              const ownerCount = new Set(
                s.departments.map((d) => d.salesOwner).filter(Boolean) as string[],
              ).size;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left transition',
                    active?.id === s.id
                      ? 'border-brand bg-brand/5'
                      : 'border-transparent hover:bg-muted/50',
                  )}
                >
                  <Building2
                    className={cn(
                      'h-4 w-4 shrink-0',
                      active?.id === s.id ? 'text-brand' : 'text-muted-foreground',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5">
                        <Users className="h-3 w-3" />
                        {s.departments.length} 部门 / {ownerCount} 销售
                      </span>
                      {s.province && (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" />
                          {s.province}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                </button>
              );
            })}
            {filtered.length === 0 && !loading && (
              <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                未找到匹配的学校
              </div>
            )}
          </div>
        </aside>

        <section className="rounded-lg border border-border bg-card">
          {active ? (
            <>
              <header className="flex items-start justify-between gap-3 border-b border-border p-5">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">{active.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    共 {active.departments.length} 个部门，对接{' '}
                    {new Set(active.departments.map((d) => d.salesOwner).filter(Boolean) as string[]).size} 位销售
                  </p>
                </div>
                <span className="rounded border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  学校档案
                </span>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-2 font-medium">部门</th>
                      <th className="px-5 py-2 font-medium">负责销售</th>
                      <th className="px-5 py-2 font-medium">销售团队</th>
                      <th className="px-5 py-2 font-medium">提交人 / UID</th>
                      <th className="px-5 py-2 font-medium">联系方式</th>
                      <th className="px-5 py-2 font-medium">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.departments.map((d) => (
                      <tr
                        key={d.id}
                        className="border-b border-border/60 last:border-0 hover:bg-muted/20"
                      >
                        <td className="px-5 py-2.5 font-medium">{d.name}</td>
                        <td className="px-5 py-2.5 text-muted-foreground">
                          {d.salesOwner ?? '—'}
                        </td>
                        <td className="px-5 py-2.5 text-muted-foreground">
                          {d.salesTeam ?? '—'}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">
                          {d.submitter ?? '—'}
                          {d.submitterUid ? ` · ${d.submitterUid}` : ''}
                        </td>
                        <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">
                          {d.mobile ?? d.staffNo ?? '—'}
                        </td>
                        <td className="px-5 py-2.5 text-xs text-muted-foreground">
                          {d.updatedAt
                            ? new Date(d.updatedAt).toLocaleString('zh-CN', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              请选择左侧学校查看档案
            </div>
          )}
        </section>
      </div>
    </LlmLoadingMask>
  );
}
