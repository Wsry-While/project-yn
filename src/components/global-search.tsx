'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRightLeft,
  BarChart3,
  BookMarked,
  Building2,
  ClipboardList,
  CornerDownLeft,
  FileImage,
  FileText,
  GitMerge,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Loader2,
  Plane,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/web/api-client';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';

interface QuickItem {
  id: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  group: 'nav' | 'recent';
}

const NAV_ITEMS: QuickItem[] = [
  { id: 'dashboard', label: '仪表盘', href: '/dashboard', icon: LayoutDashboard, group: 'nav' },
  { id: 'workbench', label: '我的工作台', href: '/workbench', icon: Inbox, group: 'nav' },
  { id: 'risks', label: '风险中心', href: '/risks', icon: ShieldAlert, group: 'nav' },
  { id: 'kanban', label: '任务看板', href: '/kanban', icon: KanbanSquare, group: 'nav' },
  { id: 'schools', label: '学校档案', href: '/schools', icon: Building2, group: 'nav' },
  { id: 'trips', label: '项目外出', href: '/trips', icon: Plane, group: 'nav' },
  { id: 'bidding', label: '招投标截图', href: '/bidding-screenshots', icon: FileImage, group: 'nav' },
  { id: 'demands', label: '项目建设申请', href: '/project-demands', icon: ClipboardList, group: 'nav' },
  { id: 'qiming', label: '启明星建设', href: '/qiming-construction', icon: Star, group: 'nav' },
  { id: 'reports', label: 'AI 周报', href: '/reports', icon: FileText, group: 'nav' },
  { id: 'analytics', label: '多维分析', href: '/analytics', icon: BarChart3, group: 'nav' },
  { id: 'team', label: '团队', href: '/team', icon: Users, group: 'nav' },
  { id: 'data-align', label: '数据对齐', href: '/data-align', icon: GitMerge, group: 'nav' },
  { id: 'dict', label: '字典管理', href: '/dict', icon: BookMarked, group: 'nav' },
];

const RECENT_KEY = 'pc_recent_routes';
const RECENT_LIMIT = 5;

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(href: string): void {
  if (typeof window === 'undefined') return;
  try {
    const cur = loadRecent().filter((h) => h !== href);
    cur.unshift(href);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_LIMIT)));
  } catch {
    /* ignore */
  }
}

interface NlRow {
  id: string;
  title: string;
  school: string | null;
  owner: string | null;
  date: string | null;
  status: string | null;
  url: string;
}

interface NlResult {
  intent: string;
  source: 'bidding' | 'demand' | 'qiming' | 'trip';
  count: number;
  rows: NlRow[];
}

const SOURCE_LABEL: Record<NlResult['source'], string> = {
  bidding: '招投标',
  demand: '建设申请',
  qiming: '启明星',
  trip: '项目外出',
};

type Mode = 'quick' | 'nl';

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [nlResult, setNlResult] = useState<NlResult | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K 唤起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 打开时初始化最近访问、聚焦
  useEffect(() => {
    if (!open) return;
    setRecent(loadRecent());
    setQuery('');
    setNlResult(null);
    setNlError(null);
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = '';
    };
  }, [open]);

  const quickItems = useMemo<QuickItem[]>(() => {
    const kw = query.trim().toLowerCase();
    const recentItems: QuickItem[] = recent
      .map((href) => NAV_ITEMS.find((n) => n.href === href))
      .filter((x): x is QuickItem => !!x)
      .map((x) => ({ ...x, group: 'recent' as const, hint: '最近访问' }));
    const navItems = kw
      ? NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(kw))
      : NAV_ITEMS;
    // 无关键词时展示「最近访问 + 全部导航」；有关键词时只展示匹配导航
    if (kw) return navItems;
    return [...recentItems, ...navItems];
  }, [query, recent]);

  // 判定是否走 NL 搜索（含中文或长度较长且非纯导航匹配）
  const mode: Mode = useMemo(() => {
    const kw = query.trim();
    if (!kw) return 'quick';
    // 含中文字符 → 自然语言查询
    if (/[\u4e00-\u9fa5]/.test(kw) && kw.length >= 2) return 'nl';
    return 'quick';
  }, [query]);

  // NL 搜索（防抖）
  useEffect(() => {
    if (mode !== 'nl') {
      setNlResult(null);
      setNlError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNlError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiFetch<NlResult>('/api/analytics/nl-query', {
          method: 'POST',
          body: JSON.stringify({ query: query.trim() }),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setNlResult(data);
          setActive(0);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setNlError(err instanceof Error ? err.message : '搜索失败');
          setNlResult(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [mode, query]);

  const go = useCallback(
    (href: string) => {
      pushRecent(href.split('?')[0]);
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const flatRows = useMemo<NlRow[]>(() => {
    if (mode === 'nl' && nlResult) return nlResult.rows;
    return [];
  }, [mode, nlResult]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const size = mode === 'nl' ? flatRows.length : quickItems.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, size - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        if (mode === 'nl') {
          const row = flatRows[active];
          if (row) go(row.url);
        } else {
          const item = quickItems[active];
          if (item) go(item.href);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    },
    [mode, flatRows, quickItems, active, go],
  );

  // active 项滚动可见
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative hidden h-8 w-56 items-center text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 md:flex"
        aria-label="全局搜索 (⌘K)"
      >
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex h-8 w-full items-center rounded-md border border-input bg-background pl-8 pr-12 text-xs text-muted-foreground/70 transition hover:border-brand/40 hover:bg-accent/40">
          全局搜索…
        </span>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
          <Kbd>⌘K</Kbd>
        </span>
      </button>

      {/* 移动端：仅图标按钮 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 md:hidden"
        aria-label="全局搜索"
      >
        <Search className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]"
          role="dialog"
          aria-modal="true"
          aria-label="全局搜索"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <div className="animate-fade-in-up relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_24px_60px_rgba(0,0,0,0.32)]">
            <div className="flex items-center gap-2 border-b border-border px-4">
              {loading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
              ) : mode === 'nl' ? (
                <Sparkles className="h-4 w-4 shrink-0 text-brand" />
              ) : (
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="搜索页面，或用中文提问（如「张三今年去了哪些学校」）"
                className="h-12 rounded-none border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-0"
              />
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {mode === 'quick' ? (
                <>
                  {quickItems.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                      没有匹配的页面
                    </div>
                  ) : (
                    <>
                      {!query.trim() && recent.length > 0 && (
                        <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          最近访问
                        </div>
                      )}
                      {quickItems.map((item, idx) => {
                        const Icon = item.icon;
                        const isRecent = item.group === 'recent';
                        return (
                          <button
                            key={item.id + (isRecent ? '-r' : '')}
                            data-idx={idx}
                            type="button"
                            onMouseEnter={() => setActive(idx)}
                            onClick={() => go(item.href)}
                            className={cn(
                              'flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left text-sm transition',
                              active === idx ? 'bg-brand-muted text-brand' : 'text-foreground hover:bg-muted/60',
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.hint && (
                              <span className="text-[10px] text-muted-foreground">{item.hint}</span>
                            )}
                            {active === idx && <CornerDownLeft className="h-3.5 w-3.5 opacity-60" />}
                          </button>
                        );
                      })}
                    </>
                  )}
                </>
              ) : (
                <>
                  {nlError ? (
                    <div className="px-3 py-6 text-center text-sm text-status-danger">
                      {nlError}
                      <p className="mt-1 text-xs text-muted-foreground">
                        试试明确包含「招投标 / 建设申请 / 启明星 / 外出」关键词
                      </p>
                    </div>
                  ) : loading && !nlResult ? (
                    <div className="space-y-1.5 px-2 py-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-10 animate-pulse rounded bg-muted" />
                      ))}
                    </div>
                  ) : nlResult && nlResult.rows.length > 0 ? (
                    <>
                      <div className="flex items-center gap-2 px-2 pb-1 pt-1 text-[11px] text-muted-foreground">
                        <Sparkles className="h-3 w-3" />
                        <span className="flex-1 truncate">{nlResult.intent}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
                          {SOURCE_LABEL[nlResult.source]} · {nlResult.count} 条
                        </span>
                      </div>
                      {nlResult.rows.map((row, idx) => (
                        <button
                          key={row.id}
                          data-idx={idx}
                          type="button"
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => go(row.url)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded px-2.5 py-2 text-left text-sm transition',
                            active === idx ? 'bg-brand-muted text-brand' : 'text-foreground hover:bg-muted/60',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{row.title}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                              {row.school && <span>{row.school}</span>}
                              {row.owner && (
                                <>
                                  <span className="text-border">·</span>
                                  <span>{row.owner}</span>
                                </>
                              )}
                              {row.date && (
                                <>
                                  <span className="text-border">·</span>
                                  <span className="font-mono">{row.date}</span>
                                </>
                              )}
                            </span>
                          </span>
                          {row.status && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {row.status}
                            </span>
                          )}
                          <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 opacity-40" />
                        </button>
                      ))}
                    </>
                  ) : (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                      未找到匹配记录
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Kbd>↑↓</Kbd> 选择
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>↵</Kbd> 打开
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>esc</Kbd> 关闭
                </span>
              </div>
              <span>中文输入将智能搜索业务数据</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
