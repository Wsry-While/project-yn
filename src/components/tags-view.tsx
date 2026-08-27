'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  closeAll,
  closeOthers,
  closeTag,
  openTag,
  useTags,
  type TagItem,
} from '@/lib/web/tags-store';

const LABEL_MAP: Record<string, string> = {
  dashboard: '仪表盘',
  workbench: '我的工作台',
  kanban: '任务看板',
  schools: '学校档案',
  trips: '项目外出',
  'bidding-screenshots': '招投标截图',
  'project-demands': '项目建设申请',
  'qiming-construction': '启明星建设',
  reports: 'AI 周报',
  analytics: '多维分析',
  risks: '风险中心',
  team: '团队',
  'data-align': '数据对齐',
  dict: '字典管理',
  settings: '项目设置',
  system: '系统管理',
};

function resolveLabel(pathname: string): string {
  const seg = pathname.split('/').filter(Boolean)[0] ?? '';
  return LABEL_MAP[seg] ?? decodeURIComponent(seg);
}

interface MenuState {
  x: number;
  y: number;
  path: string;
}

export function TagsView() {
  const router = useRouter();
  const pathname = usePathname();
  const tags = useTags();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 路由变化时新增 tag
  useEffect(() => {
    if (!pathname || pathname === '/') return;
    openTag({ path: pathname, label: resolveLabel(pathname) });
  }, [pathname]);

  // 滚到当前 tag
  useEffect(() => {
    const el = scrollerRef.current?.querySelector<HTMLElement>(`[data-path="${pathname}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname, tags.length]);

  // 关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const handleClose = (e: React.MouseEvent, tag: TagItem) => {
    e.stopPropagation();
    if (tag.affixed) return;
    const next = closeTag(tag.path);
    if (tag.path === pathname && next) {
      router.push(next);
      setReloadKey((k) => k + 1);
    }
  };

  const handleContext = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, path });
  };

  const runAction = (action: 'refresh' | 'close' | 'others' | 'all') => {
    if (!menu) return;
    const { path } = menu;
    setMenu(null);
    if (action === 'refresh') {
      router.refresh();
      setReloadKey((k) => k + 1);
    } else if (action === 'close') {
      const tag = tags.find((t) => t.path === path);
      if (tag && !tag.affixed) {
        const next = closeTag(path);
        if (path === pathname && next) {
          router.push(next);
          setReloadKey((k) => k + 1);
        }
      }
    } else if (action === 'others') {
      closeOthers(path);
      if (path !== pathname) router.push(path);
      setReloadKey((k) => k + 1);
    } else if (action === 'all') {
      const next = closeAll();
      router.push(next);
      setReloadKey((k) => k + 1);
    }
  };

  const current = tags.find((t) => t.path === pathname);
  const canCloseCurrent = current && !current.affixed;

  return (
    <div
      className={cn(
        'flex h-9 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-2',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
      ref={scrollerRef}
      data-reload-key={reloadKey}
    >
      {tags.map((tag) => {
        const active = tag.path === pathname;
        return (
          <button
            key={tag.path}
            data-path={tag.path}
            type="button"
            onClick={() => router.push(tag.path)}
            onContextMenu={(e) => handleContext(e, tag.path)}
            className={cn(
              'group inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border px-2.5 text-xs transition-colors',
              active
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-transparent bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {tag.affixed && !active && (
              <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            )}
            <span>{tag.label}</span>
            {!tag.affixed && (
              <span
                role="button"
                aria-label="关闭"
                onClick={(e) => handleClose(e, tag)}
                className={cn(
                  'ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-sm transition',
                  active ? 'hover:bg-white/20' : 'hover:bg-border',
                )}
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}

      {menu && (
        <div
          role="menu"
          style={{ top: menu.y, left: menu.x }}
          className="fixed z-50 min-w-[120px] rounded-md border border-border bg-card py-1 text-xs shadow-dropdown"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction('refresh')}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
          >
            <RefreshCw className="h-3 w-3" />
            刷新
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canCloseCurrent && menu.path === pathname}
            onClick={() => runAction('close')}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-40"
          >
            <X className="h-3 w-3" />
            关闭
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction('others')}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
          >
            关闭其他
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction('all')}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
          >
            关闭所有
          </button>
        </div>
      )}
    </div>
  );
}
