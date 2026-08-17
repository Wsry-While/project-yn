'use client';
import { useEffect } from 'react';

export interface HotkeyMap {
  /** 数字键 1-4：切页；key 为目标路径 */
  navigation?: (target: 'dashboard' | 'kanban' | 'team' | 'settings') => void;
  newTask?: () => void;
  closeAll?: () => void;
}

/**
 * 全局键盘快捷键：
 * - ⌘/Ctrl + 1..4   切换页面
 * - ⌘/Ctrl + N       新建任务
 * - Esc              关闭所有浮层
 *
 * 在输入框中打字时，仅保留 Esc 生效，避免劫持用户输入。
 */
export function useHotkeys(map: HotkeyMap): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        map.closeAll?.();
        return;
      }
      if (isEditing) return;
      if (!(e.metaKey || e.ctrlKey)) return;

      if (e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        const targets = ['dashboard', 'kanban', 'team', 'settings'] as const;
        map.navigation?.(targets[Number(e.key) - 1]);
        return;
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        map.newTask?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [map]);
}
