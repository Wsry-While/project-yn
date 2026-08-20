'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plane,
  FileText as FileTextIcon,
  ClipboardList,
  Star,
  ChevronDown,
  GitBranch,
  CircleDot,
} from 'lucide-react';
import type { School360ProjectThread, School360TimelineItem } from '@/lib/domain/school-360-service';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const SOURCE_META: Record<
  School360TimelineItem['source'],
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: 'brand' | 'info' | 'warning' | 'success';
    color: string;
  }
> = {
  bidding: { label: '招投标', icon: FileTextIcon, tone: 'brand', color: 'var(--brand)' },
  trip: { label: '外出', icon: Plane, tone: 'info', color: '#0ea5e9' },
  demand: { label: '建设申请', icon: ClipboardList, tone: 'warning', color: 'var(--status-warning)' },
  qiming: { label: '启明星', icon: Star, tone: 'success', color: 'var(--status-success)' },
};

function StageDot({ source, isOpen }: { source: School360TimelineItem['source']; isOpen: boolean }) {
  const meta = SOURCE_META[source];
  const Icon = meta.icon;
  const toneBg: Record<string, string> = {
    brand: 'bg-brand/10 text-brand ring-brand/30',
    info: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
    warning: 'bg-status-warning/12 text-status-warning ring-status-warning/30',
    success: 'bg-status-success/12 text-status-success ring-status-success/30',
  };
  return (
    <span
      className={cn(
        'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-inset',
        toneBg[meta.tone],
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {isOpen && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-status-danger ring-2 ring-card" />
      )}
    </span>
  );
}

function ThreadCard({ thread }: { thread: School360ProjectThread }) {
  const [open, setOpen] = useState(thread.hasOpen);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-card transition-colors',
        thread.hasOpen ? 'border-border' : 'border-border/60',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
          <GitBranch className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-foreground">{thread.displayName}</h4>
            <div className="flex items-center gap-1">
              {thread.sources.map((s) => (
                <span
                  key={s}
                  title={SOURCE_META[s].label}
                  className="inline-flex h-1.5 w-1.5 rounded-full"
                  style={{ background: SOURCE_META[s].color }}
                />
              ))}
            </div>
            {thread.hasOpen && <Badge tone="danger">进行中</Badge>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="font-mono">
              {thread.startDate ?? '—'} ~ {thread.endDate ?? '—'}
            </span>
            <span>·</span>
            <span>{thread.items.length} 条记录</span>
            <span>·</span>
            <span>{thread.sources.length} 个业务阶段</span>
          </div>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border bg-muted/10 px-4 py-3">
          <ol className="relative">
            {thread.items.map((it, idx) => {
              const isLast = idx === thread.items.length - 1;
              const meta = SOURCE_META[it.source];
              return (
                <li key={`${it.source}-${it.id}`} className="relative flex gap-3 pb-3 last:pb-0">
                  {!isLast && (
                    <span
                      aria-hidden
                      className="absolute left-[13px] top-8 h-[calc(100%-1.25rem)] w-px bg-border"
                    />
                  )}
                  <StageDot source={it.source} isOpen={it.isOpen} />
                  <Link
                    href={it.url}
                    className="group flex min-w-0 flex-1 flex-col rounded-md px-2 py-1 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="truncate text-[13px] text-foreground/90 group-hover:text-foreground">
                        {it.title.replace(/^[^·]+·\s*/, '')}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      {it.date && (
                        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                          <CircleDot className="h-2.5 w-2.5" />
                          {it.date.slice(0, 10)}
                        </span>
                      )}
                      {it.subtitle && <span className="truncate">{it.subtitle}</span>}
                      {it.status && (
                        <span className={cn(it.isOpen ? 'text-status-warning' : 'text-status-success')}>
                          · {it.status}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

export function SchoolProjectThreads({
  threads,
  className,
}: {
  threads: School360ProjectThread[];
  className?: string;
}) {
  const { open, closed, ungrouped } = useMemo(() => {
    const o: School360ProjectThread[] = [];
    const c: School360ProjectThread[] = [];
    const u: School360ProjectThread[] = [];
    for (const t of threads) {
      if (t.key === '__ungrouped__') u.push(t);
      else if (t.hasOpen) o.push(t);
      else c.push(t);
    }
    return { open: o, closed: c, ungrouped: u };
  }, [threads]);

  if (threads.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        该学校暂无业务记录，无法聚类项目主线。
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {open.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-status-danger" />
            进行中的项目
            <span className="font-mono text-muted-foreground/60">{open.length}</span>
          </h3>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {open.map((t) => (
              <ThreadCard key={t.key} thread={t} />
            ))}
          </div>
        </section>
      )}
      {closed.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
            已交付的项目
            <span className="font-mono text-muted-foreground/60">{closed.length}</span>
          </h3>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {closed.map((t) => (
              <ThreadCard key={t.key} thread={t} />
            ))}
          </div>
        </section>
      )}
      {ungrouped.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            日常运营 / 未归属
          </h3>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {ungrouped.map((t) => (
              <ThreadCard key={t.key} thread={t} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
