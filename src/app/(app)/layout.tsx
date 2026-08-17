import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/supabase-auth';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: '项目中心',
};

/**
 * 所有登录后的业务页面都挂在 (app) 路由组下，复用 AppShell。
 * 未登录访问统一跳转到首页（超星登录入口）。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser(await cookies());
  if (!session) {
    redirect('/');
  }
  return <AppShell user={session.user}>{children}</AppShell>;
}
