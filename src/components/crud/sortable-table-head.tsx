'use client';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import type { SortState } from '@/hooks/use-server-paginated-list';
import { cn } from '@/lib/utils';

interface SortableTableHeadProps {
  /** 后端排序字段（白名单内的列名） */
  sortKey: string;
  /** 当前排序状态 */
  sort: SortState | null;
  /** 点击切换排序（由 useServerPaginatedList 提供） */
  onSort: (by: string) => void;
  children: React.ReactNode;
  className?: string;
  /** 右对齐（数字/操作列） */
  align?: 'left' | 'right';
}

/**
 * 可点击排序的表头：展示升降序状态，点击同一列在 降序→升序→取消 间循环。
 * 未排序时显示中性图标，hover 高亮；右对齐时内容与图标整体靠右。
 */
export function SortableTableHead({
  sortKey,
  sort,
  onSort,
  children,
  className,
  align = 'left',
}: SortableTableHeadProps) {
  const active = sort?.by === sortKey;
  const Icon = !active ? ChevronsUpDown : sort?.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={cn(
        'select-none cursor-pointer transition-colors hover:bg-muted',
        align === 'right' && 'text-right',
        className,
      )}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      title={active ? '点击切换排序' : '点击按此列排序'}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-foreground font-medium' : '',
        )}
      >
        {children}
        <Icon
          className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-brand' : 'text-muted-foreground/50')}
        />
      </span>
    </TableHead>
  );
}
