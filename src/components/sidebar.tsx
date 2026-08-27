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
  Inbox,
  ShieldAlert,
  FileText,
  GitMerge,
  BarChart3,
  BookMarked,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { themeStore, toggleTheme } from '@/lib/web/theme';
import { appStore } from '@/lib/web/app-store';
import { useSidebarCollapsed, toggleCollapsed } from '@/lib/web/ui-store';
import { LogoutButton } from '@/components/logout-button';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/lib/web/use-permissions';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  match: (pathname: string) => boolean;
  perm?: string;
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
    href: '/workbench',
    label: '我的工作台',
    icon: Inbox,
    shortcut: '⌘2',
    match: (p) => p.startsWith('/workbench'),
  },
  {
    href: '/risks',
    label: '风险中心',
    icon: ShieldAlert,
    shortcut: '⌘3',
    match: (p) => p.startsWith('/risks'),
  },
  {
    href: '/kanban',
    label: '任务看板',
    icon: KanbanSquare,
    shortcut: '⌘4',
    match: (p) => p.startsWith('/kanban'),
  },
  {
    href: '/schools',
    label: '学校档案',
    icon: Building2,
    shortcut: '⌘5',
    match: (p) => p.startsWith('/schools'),
  },
  {
    href: '/trips',
    label: '项目外出',
    icon: Plane,
    shortcut: '⌘6',
    match: (p) => p.startsWith('/trips'),
  },
  {
    href: '/bidding-screenshots',
    label: '招投标截图',
    icon: FileImage,
    shortcut: '⌘7',
    match: (p) => p.startsWith('/bidding-screenshots'),
  },
  {
    href: '/project-demands',
    label: '项目建设申请',
    icon: ClipboardList,
    shortcut: '⌘8',
    match: (p) => p.startsWith('/project-demands'),
  },
  {
    href: '/qiming-construction',
    label: '启明星建设',
    icon: Star,
    shortcut: '⌘9',
    match: (p) => p.startsWith('/qiming-construction'),
  },
  {
    href: '/reports',
    label: 'AI 周报',
    icon: FileText,
    match: (p) => p.startsWith('/reports'),
  },
  {
    href: '/analytics',
    label: '多维分析',
    icon: BarChart3,
    match: (p) => p.startsWith('/analytics'),
  },
  {
    href: '/team',
    label: '团队',
    icon: Users,
    match: (p) => p.startsWith('/team'),
    perm: 'team:list',
  },
  {
    href: '/data-align',
    label: '数据对齐',
    icon: GitMerge,
    match: (p) => p.startsWith('/data-align'),
    perm: 'data-align:list',
  },
  {
    href: '/dict',
    label: '字典管理',
    icon: BookMarked,
    match: (p) => p.startsWith('/dict'),
    perm: 'dict:list',
  },
  {
    href: '/system/users',
    label: '系统管理',
    icon: ShieldCheck,
    match: (p) => p.startsWith('/system'),
    perm: 'user:manage',
  },
  {
    href: '/settings',
    label: '项目设置',
    icon: Settings,
    shortcut: '⌘0',
    match: (p) => p.startsWith('/settings'),
  },
];

function Brand({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand text-brand-foreground shadow-sm">
        <Sparkles className="h-5 w-5" aria-hidden />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 px-1">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground shadow-sm">
        <Sparkles className="h-4.5 w-4.5" aria-hidden />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">
          项目中心
        </div>
        <div className="text-[10px] text-sidebar-foreground/50">
          教育信息化项目管理平台
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
      title={mode === 'dark' ? '浅色模式' : '深色模式'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {mode === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function NavLinks({
  onNavigate,
  collapsed,
}: {
  onNavigate?: () => void;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const { can, loaded, isSuperAdmin } = usePermissions();
  const items = NAV.filter((item) => {
    if (!item.perm) return true;
    if (!loaded) return true; // 权限未加载完先显示，避免闪烁
    if (isSuperAdmin) return true;
    return can(item.perm);
  });
  return (
    <nav
      aria-label="主导航"
      className={cn('flex flex-col gap-0.5', collapsed ? 'px-2' : 'px-2')}
    >
      {items.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        const link = (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              'group relative flex items-center rounded-md text-sm transition-colors',
              collapsed
                ? 'h-10 w-10 justify-center'
                : 'gap-2.5 px-3 py-2',
              active
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
            )}
          >
            <Icon className="h-4.5 w-4.5 shrink-0" />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
            {!collapsed && item.shortcut && (
              <kbd className="rounded bg-sidebar-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-sidebar-foreground/40 group-hover:bg-sidebar-foreground/10">
                {item.shortcut}
              </kbd>
            )}
          </Link>
        );
        return link;
      })}
    </nav>
  );
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const displayName = appStore.use((s) => s.currentUserDisplayName);
  const avatarUrl = appStore.use((s) => s.currentUserAvatarUrl);
  const uid = appStore.use((s) => s.currentUserUid);
  const orgName = appStore.use((s) => s.currentUserOrgName);

  const name = displayName || '当前用户';
  const sub = orgName || (uid ? `学工号 ${uid}` : '超星登录会话');
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  if (collapsed) {
    return (
      <div className="mt-auto flex flex-col items-center gap-2 border-t border-sidebar-border/60 py-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            referrerPolicy="no-referrer"
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-foreground/10 text-[11px] font-semibold text-sidebar-foreground">
            {initial}
          </div>
        )}
        <ThemeToggle />
        <LogoutButton />
      </div>
    );
  }
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

function CollapseToggle({ collapsed }: { collapsed: boolean }) {
  return (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
      title={collapsed ? '展开' : '收起'}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {collapsed ? (
        <PanelLeftOpen className="h-4 w-4" />
      ) : (
        <PanelLeftClose className="h-4 w-4" />
      )}
    </button>
  );
}

/**
 * 应用侧边栏。
 * 桌面端默认 210px，折叠后 64px；移动端抽屉式。
 */
export function Sidebar() {
  const [open, setOpen] = useState(false);
  const collapsed = useSidebarCollapsed();
  return (
    <>
      {/* 移动端顶栏 */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar px-4 py-2.5 text-sidebar-foreground md:hidden">
        <Brand collapsed={false} />
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
        style={{ width: collapsed ? 64 : 210 }}
        className="theme-transition sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex"
      >
        <div
          className={cn(
            'flex items-center pt-4',
            collapsed ? 'justify-center pb-4' : 'justify-between px-4 pb-4',
          )}
        >
          <Brand collapsed={collapsed} />
          {!collapsed && <CollapseToggle collapsed={collapsed} />}
        </div>
        {collapsed && (
          <div className="flex justify-center pb-2">
            <CollapseToggle collapsed={collapsed} />
          </div>
        )}
        <NavLinks collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} />
      </aside>

      {/* 移动端抽屉 */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 animate-fade-in-up flex-col bg-sidebar">
            <div className="flex items-center justify-between px-3 pb-3 pt-4">
              <Brand collapsed={false} />
              <button
                type="button"
                aria-label="关闭菜单"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} collapsed={false} />
            <SidebarFooter collapsed={false} />
          </aside>
        </div>
      )}
    </>
  );
}
