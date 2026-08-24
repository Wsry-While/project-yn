'use client';
import type { ReactNode } from 'react';
import { Search, RefreshCw, Download } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ListToolbarProps {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  /** 额外的筛选控件（Select 等），放在搜索框右侧 */
  filters?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  onExport?: () => void;
  exportDisabled?: boolean;
  exportLabel?: string;
  /** 右侧额外操作区 */
  actions?: ReactNode;
  total?: number;
  totalLabel?: string;
  className?: string;
}

/**
 * 业务列表统一工具栏：搜索框 + 筛选插槽 + 刷新/导出 + 总数。
 * 铺满宽度，搜索框 flex-1，筛选项自动换行。
 */
export function ListToolbar({
  search,
  filters,
  onRefresh,
  refreshing,
  onExport,
  exportDisabled,
  exportLabel = '导出 CSV',
  actions,
  total,
  totalLabel = '共',
  className,
}: ListToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-border px-4 py-3',
        className,
      )}
    >
      {search && (
        <div className="relative h-8 min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? '搜索'}
            className="h-8 pl-8 text-sm"
          />
        </div>
      )}
      {filters}
      {actions}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground transition hover:text-foreground"
          aria-label="刷新"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          刷新
        </button>
      )}
      {onExport && (
        <button
          type="button"
          onClick={onExport}
          disabled={exportDisabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {exportLabel}
        </button>
      )}
      {typeof total === 'number' && (
        <div className="ml-auto font-mono text-[11px] text-muted-foreground">
          {totalLabel} <span className="text-foreground">{total}</span> 条
        </div>
      )}
    </div>
  );
}
