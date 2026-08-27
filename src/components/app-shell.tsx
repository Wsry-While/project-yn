'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Bell, Menu as MenuIcon } from 'lucide-react';
import { Sidebar } from '@/components/sidebar';
import { ToastViewport } from '@/components/toast-viewport';
import { AiAssistant } from '@/components/ai-assistant';
import { ThemeBootstrap } from '@/components/theme-bootstrap';
import { TagsView } from '@/components/tags-view';
import { useHotkeys } from '@/lib/web/hotkeys';
import { appStore, setCurrentProject, setCurrentUser } from '@/lib/web/app-store';
import { projectWebService } from '@/lib/web/project-web-service';
import type { SessionUser } from '@/lib/supabase-auth';
import { showToast } from '@/lib/web/toast-store';
import { NewTaskDrawer } from '@/components/new-task-drawer';
import { GlobalSearch } from '@/components/global-search';
import { toggleCollapsed } from '@/lib/web/ui-store';
import { bootstrapPermissions } from '@/lib/web/use-permissions';

const ROUTE_LABELS: Record<string, string> = {
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
  team: '团队管理',
  'data-align': '数据对齐',
  dict: '字典管理',
  system: '系统管理',
  settings: '项目设置',
};

/**
 * 登录后应用外壳（RuoYi 风格）：
 * - 左侧 Sidebar（210/64 可折叠）
 * - 顶部 50px 白色面包屑 + Tags-View 多页签
 */
export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  useEffect(() => {
    bootstrapPermissions();
  }, []);

  useEffect(() => {
    setCurrentUser({
      id: user.id,
      displayName:
        user.chaoxing.displayName || user.profile.displayName || user.chaoxing.uid || user.id,
      avatarUrl: user.profile.avatar,
      uid: user.chaoxing.uid,
      orgName: user.chaoxing.orgName,
    });
    let cancelled = false;
    (async () => {
      try {
        const projects = await projectWebService.list();
        if (cancelled) return;
        const first = projects[0] ?? null;
        setCurrentProject(first);
        if (!first) {
          showToast('尚未创建项目，请联系管理员或访问首页初始化', { kind: 'info' });
        }
      } catch (err) {
        console.error('[app-shell] 加载项目失败:', err);
        showToast('加载项目失败，请刷新页面重试', { kind: 'error' });
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useHotkeys({
    navigation: (target) => router.push(`/${target === 'dashboard' ? '' : target}`),
    newTask: () => setNewTaskOpen(true),
    closeAll: () => setNewTaskOpen(false),
  });

  const project = appStore.use((s) => s.currentProject);

  const breadcrumbs = useMemo(() => {
    const segs = pathname.split('/').filter(Boolean);
    if (segs.length === 0) return [{ label: '仪表盘', href: '/dashboard' }];
    return segs.map((seg, idx) => {
      const label = ROUTE_LABELS[seg] ?? decodeURIComponent(seg);
      return {
        label,
        href: '/' + segs.slice(0, idx + 1).join('/'),
      };
    });
  }, [pathname]);

  return (
    <div className="theme-transition flex min-h-screen bg-background text-foreground">
      <ThemeBootstrap />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[50px] items-center justify-between gap-4 border-b border-border bg-card px-4 shadow-sm">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="折叠侧边栏"
              onClick={toggleCollapsed}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <MenuIcon className="h-4 w-4" />
            </button>
            <nav className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
              {breadcrumbs.map((b, idx) => (
                <span key={b.href} className="flex items-center gap-1.5">
                  {idx > 0 && <ChevronRight className="h-3 w-3 text-border" aria-hidden />}
                  {idx === breadcrumbs.length - 1 ? (
                    <span className="truncate font-medium text-foreground">{b.label}</span>
                  ) : (
                    <Link
                      href={b.href}
                      className="truncate text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {b.label}
                    </Link>
                  )}
                </span>
              ))}
              {project && (
                <>
                  <span className="ml-2 text-border">·</span>
                  <span className="truncate text-xs text-muted-foreground" title={project.name}>
                    {project.name}
                  </span>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <GlobalSearch />
            <button
              type="button"
              aria-label="通知"
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand ring-2 ring-card" />
            </button>
          </div>
        </header>
        <TagsView />
        <main key={pathname} className="flex-1 animate-fade-in-up p-4">
          {children}
        </main>
      </div>
      <ToastViewport />
      <AiAssistant />
      <NewTaskDrawer open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
    </div>
  );
}
