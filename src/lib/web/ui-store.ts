'use client';
import { useSyncExternalStore } from 'react';

type Listener = () => void;

const STORAGE_KEY = 'pc_ui_collapsed';

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let collapsed = false;
let initialized = false;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: Listener) {
  listeners.add(l);
  if (!initialized) {
    initialized = true;
    collapsed = readInitial();
    emit();
  }
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return collapsed;
}

function setCollapsed(next: boolean) {
  if (collapsed === next) return;
  collapsed = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // ignore
  }
  emit();
}

export function toggleCollapsed() {
  setCollapsed(!collapsed);
}

export function setSidebarCollapsed(next: boolean) {
  setCollapsed(next);
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
