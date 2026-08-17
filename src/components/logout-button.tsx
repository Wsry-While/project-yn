'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const handleLogout = async () => {
    setIsPending(true);

    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        throw new Error(`退出登录失败: ${response.status}`);
      }
    } catch (error) {
      console.error(error);
    } finally {
      // 服务端已通过 Set-Cookie 清除 Supabase Auth Session，刷新即可
      router.refresh();
      setIsPending(false);
    }
  };

  return (
    <Button disabled={isPending} variant="outline" onClick={handleLogout}>
      <LogOut className="size-4" />
      {isPending ? '正在退出...' : '退出登录'}
    </Button>
  );
}
