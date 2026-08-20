'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Settings,
  Sun,
  Moon,
  Sparkles,
  Menu,
  X,
  Building2,
  Plane,
  FileImage,
  ClipboardList,
  Star,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { themeStore, toggleTheme } from '@/lib/web/theme';
import { appStore } from '@/lib/web/app-store';
import { LogoutButton } from '@/components/logout-button';
import { Button } from '@/components/ui/button';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut: string;
  match: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: '仪表盘',
    icon: LayoutDashboard,
    shortcut: '⌘1',
    match: (p) => p === '/dashboard' || p === '/',
  },
  {
    href: '/kanban',
    label: '任务看板',
    icon: KanbanSquare,
    shortcut: '⌘2',
    match: (p) => p.startsWith('/kanban'),
  },
  {
    href: '/schools',
    label: '学校档案',
    icon: Building2,
    shortcut: '⌘3',
    match: (p) => p.startsWith('/schools'),
  },
  {
    href: '/trips',
    label: '项目外出',
    icon: Plane,
    shortcut: '⌘4',
    match: (p) => p.startsWith('/trips'),
  },
  {
    href: '/bidding-screenshots',
    label: '招投标截图',
    icon: FileImage,
    shortcut: '⌘5',
    match: (p) => p.startsWith('/bidding-screenshots'),
  },
  {
    href: '/project-demands',
    label: '项目建设申请',
    icon: ClipboardList,
    shortcut: '⌘6',
    match: (p) => p.startsWith('/project-demands'),
  },
  {
    href: '/qiming-construction',
    label: '启明星建设',
    icon: Star,
    shortcut: '⌘7',
    match: (p) => p.startsWith('/qiming-construction'),
  },
  {
    href: '/team',
    label: '团队',
    icon: Users,
    shortcut: '⌘8',
    match: (p) => p.startsWith('/team'),
  },
  {
    href: '/settings',
    label: '项目设置',
    icon: Settings,
    shortcut: '⌘9',
    match: (p) => p.startsWith('/settings'),
  },
];

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-brand-foreground shadow-[0_1px_0_rgba(255,255,255,0.16)_inset]">
        <Sparkles className="h-4 w-4" aria-hidden />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">
          项目中心
        </div>
        <div className="font-mono text-[10px] text-sidebar-foreground/50">
          Project Hub · v1.0
        </div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const mode = themeStore.use((s) => s.mode);
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={mode === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="主导航" className="flex flex-col gap-0.5 px-2">
      {NAV.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition',
              active
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
            )}
          >
            {active && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand"
              />
            )}
            <Icon className="h-4 w-4" />
            <span className="flex-1">{item.label}</span>
            <kbd className="rounded bg-sidebar-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-sidebar-foreground/40 group-hover:bg-sidebar-foreground/10">
              {item.shortcut}
            </kbd>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  const displayName = appStore.use((s) => s.currentUserDisplayName);
  const avatarUrl = appStore.use((s) => s.currentUserAvatarUrl);
  const uid = appStore.use((s) => s.currentUserUid);
  const orgName = appStore.use((s) => s.currentUserOrgName);

  const name = displayName || '当前用户';
  const sub = orgName || (uid ? `学工号 ${uid}` : '超星登录会话');
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="mt-auto flex items-center gap-2 border-t border-sidebar-border/60 px-3 py-3">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          referrerPolicy="no-referrer"
          className="h-8 w-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-foreground/10 text-[11px] font-semibold text-sidebar-foreground">
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13px] text-sidebar-foreground">{name}</div>
        <div className="truncate text-[11px] text-sidebar-foreground/50">{sub}</div>
      </div>
      <ThemeToggle />
      <LogoutButton />
    </div>
  );
}

/**
 * 应用侧边栏。桌面端固定 240px，移动端抽屉式。
 */
export function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* 移动端顶栏 */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-sidebar px-4 py-2.5 text-sidebar-foreground md:hidden">
        <Brand />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="打开菜单"
          onClick={() => setOpen(true)}
          className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      {/* 桌面侧边栏 */}
      <aside
        aria-label="侧边栏"
        className="theme-transition sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex"
      >
        <div className="px-3 pb-4 pt-4">
          <Brand />
        </div>
        <NavLinks />
        <SidebarFooter />
      </aside>

      {/* 移动端抽屉 */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 animate-fade-in-up flex-col bg-sidebar">
            <div className="flex items-center justify-between px-3 pb-3 pt-4">
              <Brand />
              <button
                type="button"
                aria-label="关闭菜单"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <SidebarFooter />
          </aside>
        </div>
      )}
    </>
  );
}
