'use client';
import type { ReactNode } from 'react';
import { Search, RefreshCw, Download, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ListToolbarProps {
  search?: {
    value: string;
    onChange: (value: string) => void;
    onSubmit?: () => void;
    placeholder?: string;
  };
  /** 额外的筛选控件（Select 等） */
  filters?: ReactNode;
  /** 右侧主要操作（如「新建」） */
  actions?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  onReset?: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  onExport?: () => void;
  exportDisabled?: boolean;
  exportLabel?: string;
  total?: number;
  totalLabel?: string;
  className?: string;
}

/**
 * RuoYi 风格列表工具栏：
 * 搜索框 + 筛选 + [重置] [查询(主)] ... [导出] [刷新] [actions]
 * 窄屏自动 flex-wrap。
 */
export function ListToolbar({
  search,
  filters,
  actions,
  onRefresh,
  refreshing,
  onReset,
  onSubmit,
  submitLabel = '查询',
  onExport,
  exportDisabled,
  exportLabel = '导出',
  total,
  totalLabel = '共',
  className,
}: ListToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2.5',
        className,
      )}
    >
      {search && (
        <div className="relative h-8 min-w-[200px] flex-1 md:max-w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                search.onSubmit?.();
                onSubmit?.();
              }
            }}
            placeholder={search.placeholder ?? '搜索'}
            className="h-8 rounded-sm pl-8 text-xs"
          />
        </div>
      )}
      {filters}
      {onSubmit && (
        <Button
          size="sm"
          className="h-8 rounded-sm"
          onClick={onSubmit}
          disabled={refreshing}
        >
          <Search className="h-3.5 w-3.5" />
          {submitLabel}
        </Button>
      )}
      {onReset && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-sm"
          onClick={onReset}
          disabled={refreshing}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重置
        </Button>
      )}
      {actions}
      <div className="ml-auto flex items-center gap-2">
        {onExport && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-sm"
            onClick={onExport}
            disabled={exportDisabled}
          >
            <Download className="h-3.5 w-3.5" />
            {exportLabel}
          </Button>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            aria-label="刷新"
            title="刷新"
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>
        )}
        {typeof total === 'number' && (
          <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">
            {totalLabel} <span className="font-medium text-foreground">{total}</span> 条
          </span>
        )}
      </div>
    </div>
  );
}
