'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface DescriptionsItem {
  label: React.ReactNode;
  children?: React.ReactNode;
  span?: number;
}

interface DescriptionsProps {
  column?: 1 | 2 | 3 | 4 | 6;
  bordered?: boolean;
  items?: DescriptionsItem[];
  title?: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/**
 * RuoYi / Element 风格的字段描述列表：
 * 左侧 label-cell 灰底右对齐，右侧 value-cell，表格化布局。
 * 采用真实 <table>，保证列宽和跨行/跨列稳定。
 * 移动端通过 block 化降级为单列。
 */
export function Descriptions({
  column = 3,
  bordered = true,
  items,
  title,
  extra,
  className,
  children,
}: DescriptionsProps) {
  const list = items ?? [];

  // 将 items 按 column 个一行分组
  const rows: DescriptionsItem[][] = [];
  let cur: DescriptionsItem[] = [];
  let acc = 0;
  for (const it of list) {
    const span = Math.min(it.span ?? 1, column);
    if (acc + span > column && cur.length > 0) {
      rows.push(cur);
      cur = [];
      acc = 0;
    }
    cur.push(it);
    acc += span;
    if (acc >= column) {
      rows.push(cur);
      cur = [];
      acc = 0;
    }
  }
  if (cur.length > 0) rows.push(cur);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md',
        bordered ? 'border border-border' : '',
        className,
      )}
    >
      {(title || extra) && (
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {extra}
        </div>
      )}
      <div className="md:hidden">
        {list.map((it, idx) => (
          <div key={idx} className="border-b border-border last:border-b-0">
            <div className="bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {it.label}
            </div>
            <div className="px-3 py-2 text-sm">{it.children ?? '—'}</div>
          </div>
        ))}
      </div>
      <table className="hidden w-full border-collapse md:table">
        <tbody>
          {rows.map((row, rIdx) => (
            <tr key={rIdx} className="border-b border-border last:border-b-0">
              {row.map((it, cIdx) => {
                const span = Math.min(it.span ?? 1, column);
                return (
                  <React.Fragment key={cIdx}>
                    <th
                      className={cn(
                        'w-[160px] bg-muted/50 px-3 py-2 text-right text-xs font-medium text-muted-foreground',
                        bordered ? 'border-r border-border' : '',
                      )}
                    >
                      {it.label}
                    </th>
                    <td
                      colSpan={span * 2 - 1}
                      className="px-3 py-2 text-sm text-foreground align-top"
                    >
                      {it.children ?? '—'}
                    </td>
                  </React.Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {children && <div className="border-t border-border bg-card p-3">{children}</div>}
    </div>
  );
}
