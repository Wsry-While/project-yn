import { clsx, type ClassValue } from 'clsx';
import { isValidElement } from 'react';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 判断传入值是否为「组件类型」（可被 JSX 渲染为 <Comp />），
 * 而不是已经渲染好的 ReactNode。
 *
 * 必须同时覆盖：
 * - 函数组件 / class 组件（typeof === 'function'）
 * - forwardRef / memo / lazy 对象（带 $$typeof 的对象，但不是合法 element）
 *
 * 否则把 lucide 图标（forwardRef 对象）直接当子节点渲染会抛出：
 * "Objects are not valid as a React child (found: object with keys {$$typeof, render})"。
 */
export function isComponentType(
  value: unknown,
): value is React.ComponentType<{ className?: string }> {
  if (typeof value === 'function') return true;
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !isValidElement(value) &&
    '$$typeof' in value
  ) {
    return true;
  }
  return false;
}
