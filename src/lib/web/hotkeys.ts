'use client';
import { useEffect } from 'react';

export type NavTarget =
  | 'dashboard'
  | 'workbench'
  | 'kanban'
  | 'schools'
  | 'trips'
  | 'bidding-screenshots'
  | 'project-demands'
  | 'qiming-construction'
  | 'team'
  | 'settings';

export interface HotkeyMap {
  /** 数字键 0-9：切页；key 为目标路径 */
  navigation?: (target: NavTarget) => void;
  newTask?: () => void;
  closeAll?: () => void;
}

/**
 * 全局键盘快捷键：
 * - ⌘/Ctrl + 1..9, 0   切换页面
 * - ⌘/Ctrl + N          新建任务
 * - Esc                 关闭所有浮层
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

      if ((e.key >= '1' && e.key <= '9') || e.key === '0') {
        e.preventDefault();
        const targets: NavTarget[] = [
          'dashboard',
          'workbench',
          'kanban',
          'schools',
          'trips',
          'bidding-screenshots',
          'project-demands',
          'qiming-construction',
          'team',
          'settings',
        ];
        const idx = e.key === '0' ? 9 : Number(e.key) - 1;
        map.navigation?.(targets[idx]);
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
