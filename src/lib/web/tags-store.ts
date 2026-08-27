'use client';
import { useSyncExternalStore } from 'react';

export interface TagItem {
  path: string;
  label: string;
  affixed?: boolean;
}

type Listener = () => void;
const STORAGE_KEY = 'pc_tags_view';
const MAX_TAGS = 20;

const DEFAULT_AFFIX: TagItem = { path: '/dashboard', label: '仪表盘', affixed: true };

function readInitial(): TagItem[] {
  if (typeof window === 'undefined') return [DEFAULT_AFFIX];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [DEFAULT_AFFIX];
    const parsed = JSON.parse(raw) as TagItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_AFFIX];
    // 永远保留 affixed 的 dashboard
    if (!parsed.some((t) => t.path === DEFAULT_AFFIX.path)) {
      parsed.unshift(DEFAULT_AFFIX);
    }
    return parsed;
  } catch {
    return [DEFAULT_AFFIX];
  }
}

let tags: TagItem[] = [];
let initialized = false;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
  } catch {
    // ignore
  }
}

function subscribe(l: Listener) {
  listeners.add(l);
  if (!initialized) {
    initialized = true;
    tags = readInitial();
    emit();
  }
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return tags;
}

export function openTag(tag: TagItem) {
  if (tags.some((t) => t.path === tag.path)) return;
  tags = [...tags, tag].slice(-MAX_TAGS);
  persist();
  emit();
}

export function closeTag(path: string): string | null {
  const target = tags.find((t) => t.path === path);
  if (!target || target.affixed) return null;
  const idx = tags.findIndex((t) => t.path === path);
  tags = tags.filter((t) => t.path !== path);
  persist();
  emit();
  // 返回关闭后应跳转的地址
  if (tags.length === 0) return DEFAULT_AFFIX.path;
  return tags[Math.max(0, idx - 1)].path;
}

export function closeOthers(path: string) {
  tags = tags.filter((t) => t.affixed || t.path === path);
  persist();
  emit();
}

export function closeAll(): string {
  tags = tags.filter((t) => t.affixed);
  persist();
  emit();
  return DEFAULT_AFFIX.path;
}

export function useTags(): TagItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => [DEFAULT_AFFIX]);
}
