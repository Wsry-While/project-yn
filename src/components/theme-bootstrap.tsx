'use client';
import { useEffect } from 'react';
import { initTheme } from '@/lib/web/theme';

/**
 * 在客户端挂载前应用主题，避免 FOUC（Flash of Unstyled Content）。
 * 不能放 layout.tsx 的内联脚本里，因为 Next 16 App Router 的 body 是 Server Component。
 */
export function ThemeBootstrap() {
  useEffect(() => {
    initTheme();
  }, []);
  return null;
}
