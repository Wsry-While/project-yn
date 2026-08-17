'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { ToastViewport } from '@/components/toast-viewport';
import { AiAssistant } from '@/components/ai-assistant';
import { ThemeBootstrap } from '@/components/theme-bootstrap';
import { useHotkeys } from '@/lib/web/hotkeys';
import { appStore, setCurrentProject, setCurrentUser } from '@/lib/web/app-store';
import { projectWebService } from '@/lib/web/project-web-service';
import type { SessionUser } from '@/lib/supabase-auth';
import { showToast } from '@/lib/web/toast-store';
import { NewTaskDrawer } from '@/components/new-task-drawer';

/**
 * 登录后应用外壳：
 * - 左侧 Sidebar（桌面固定 / 移动抽屉）
 * - 右侧主内容区
 * - 全局 Toast、AI 助手抽屉、快捷键
 *
 * 数据初始化：拉取当前用户的第一个项目作为上下文。
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
    setCurrentUser({
      id: user.id,
      displayName: user.profile.displayName || user.chaoxing.displayName || user.chaoxing.uid,
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

  return (
    <div className="theme-transition flex min-h-screen bg-background text-foreground">
      <ThemeBootstrap />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-3 border-b border-border bg-background/80 px-5 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono text-[11px] uppercase tracking-wider">项目</span>
              <span className="h-3 w-px bg-border" />
              <span className="truncate font-medium text-foreground">
                {project?.name ?? (ready ? '未选择项目' : '加载中…')}
              </span>
            </div>
          </div>
          <div className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              ⌘N
            </kbd>
            <span>新建任务</span>
            <span className="mx-2 h-3 w-px bg-border" />
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              ⌘1-6
            </kbd>
            <span>切换页面</span>
          </div>
        </header>
        <main key={pathname} className="flex-1 animate-fade-in-up">
          {children}
        </main>
      </div>
      <ToastViewport />
      <AiAssistant />
      <NewTaskDrawer open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
    </div>
  );
}
