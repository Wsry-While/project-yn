import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/supabase-auth';
import LoginButton from '@/components/login-button';
import { LogoutButton } from '@/components/logout-button';
import UserProfile from '@/components/user-profile';
import { getChaoxingLoginOptions } from '@/lib/chaoxing-client';

export const metadata: Metadata = {
  title: '首页',
  description: '项目中心 · 超星 OAuth 登录入口',
};

export default async function Home() {
  const session = await getSessionUser(await cookies());

  // 已登录用户直接进入仪表盘
  if (session) {
    redirect('/dashboard');
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      {/* 背景网格，Linear 式冷峻工程感 */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(79,70,229,0.12),transparent_60%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:32px_32px]"
      />
      <main className="relative flex w-full max-w-md flex-col items-center gap-6 px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-[0_8px_24px_rgba(79,70,229,0.35)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-6 w-6"
            aria-hidden
          >
            <path
              d="M4 6h16M4 12h10M4 18h7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">项目中心</h1>
          <p className="text-sm text-muted-foreground">
            内部团队项目管理平台。使用超星账号登录后进入工作台。
          </p>
        </div>
        <LoginButton {...getChaoxingLoginOptions()} />
        <p className="text-xs text-muted-foreground">
          登录即表示你同意在内部范围内使用本平台。
        </p>
      </main>
    </div>
  );
}
