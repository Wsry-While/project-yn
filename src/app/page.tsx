import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getChaoxingLoginOptions } from '@/lib/chaoxing-client';
import { getSessionUser } from '@/lib/supabase-auth';
import LoginButton from '@/components/login-button';
import LogoutButton from '@/components/logout-button';
import UserProfile from '@/components/user-profile';

export const metadata: Metadata = {
  title: '首页',
  description: '超星 OAuth 登录应用',
};

export default async function Home() {
  const session = await getSessionUser(await cookies());

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <main className="flex flex-col items-center gap-6">
          <LoginButton {...getChaoxingLoginOptions()} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <main className="flex w-full max-w-md flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">登录信息</h1>
          <LogoutButton />
        </div>
        <UserProfile user={session.user} />
      </main>
    </div>
  );
}
