/**
 * 极简全局状态管理。
 *
 * 设计目标：
 * - 不引入 Redux/Zustand 等第三方依赖
 * - 基于 useSyncExternalStore，React 18+ 并发模式安全
 * - 一次创建，多组件订阅，自动浅比较
 */
import { useSyncExternalStore } from 'react';

export type Listener<T> = (state: T) => void;

export interface Store<T> {
  get: () => T;
  set: (patch: Partial<T> | ((prev: T) => T)) => void;
  subscribe: (listener: Listener<T>) => () => void;
  use: <S>(selector: (state: T) => S) => S;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  const get = () => state;
  const set: Store<T>['set'] = (patch) => {
    const next = typeof patch === 'function' ? (patch as (p: T) => T)(state) : { ...state, ...patch };
    if (Object.is(next, state)) return;
    state = next;
    listeners.forEach((l) => l(state));
  };
  const subscribe = (listener: Listener<T>) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    get,
    set,
    subscribe,
    use: <S>(selector: (s: T) => S): S =>
      useSyncExternalStore(
        (cb) => subscribe(() => cb()),
        () => selector(state),
        () => selector(initial),
      ),
  };
}
