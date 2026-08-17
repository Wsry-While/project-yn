'use client';
import { createStore } from '@/lib/web/store';

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
}

export const toastStore = createStore<ToastState>({ toasts: [] });

let counter = 0;

export function showToast(
  message: string,
  opts: { kind?: ToastKind; duration?: number } = {},
): string {
  const id = `t_${Date.now()}_${counter++}`;
  const item: ToastItem = {
    id,
    kind: opts.kind ?? 'info',
    message,
    duration: opts.duration ?? 3200,
  };
  toastStore.set((s) => ({ toasts: [...s.toasts, item] }));
  if (item.duration > 0) {
    window.setTimeout(() => dismissToast(id), item.duration);
  }
  return id;
}

export function dismissToast(id: string): void {
  toastStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
