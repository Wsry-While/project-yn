'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * 侧边栏紧凑版退出按钮。不依赖 Shadcn Button 主题，避免在深色侧边栏里的颜色冲突。
 */
export function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleLogout = async () => {
    setIsPending(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error(err);
    } finally {
      router.refresh();
      setIsPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isPending}
      aria-label="退出登录"
      title="退出登录"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}
