'use client';
import { createStore } from '@/lib/web/store';
import { readStorage, writeStorage } from '@/lib/web/storage';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'pc_theme';

function readInitial(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const stored = readStorage<ThemeMode | null>(STORAGE_KEY, null);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const themeStore = createStore<{ mode: ThemeMode }>({ mode: readInitial() });

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  writeStorage(STORAGE_KEY, mode);
  themeStore.set({ mode });
}

export function toggleTheme(): void {
  applyTheme(themeStore.get().mode === 'dark' ? 'light' : 'dark');
}

export function initTheme(): void {
  applyTheme(readInitial());
}
