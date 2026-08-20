'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * 信息化风格分页器：上一页 / 页码 / 下一页 + 总数 / 跳转
 */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(total, safePage * pageSize);

  const pages: Array<number | 'ellipsis'> = [];
  const add = (v: number | 'ellipsis') => pages.push(v);
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i += 1) add(i);
  } else {
    add(1);
    if (safePage > 3) add('ellipsis');
    for (let i = Math.max(2, safePage - 1); i <= Math.min(totalPages - 1, safePage + 1); i += 1) {
      add(i);
    }
    if (safePage < totalPages - 2) add('ellipsis');
    add(totalPages);
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-4 py-2.5 text-xs',
        className,
      )}
    >
      <div className="text-muted-foreground">
        共 <span className="font-mono text-foreground">{total}</span> 条，显示{' '}
        <span className="font-mono text-foreground">{start}</span>–
        <span className="font-mono text-foreground">{end}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex h-7 items-center gap-0.5 rounded border border-border px-2 text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          上一页
        </button>
        {pages.map((p, idx) =>
          p === 'ellipsis' ? (
            <span
              key={`e-${idx}`}
              className="inline-flex h-7 min-w-7 items-center justify-center px-1 text-muted-foreground"
            >
              …
            </span>
          ) : (
            <button
              type="button"
              key={p}
              onClick={() => onPageChange(p)}
              className={cn(
                'inline-flex h-7 min-w-7 items-center justify-center rounded border px-2 font-mono tabular-nums transition',
                p === safePage
                  ? 'border-brand bg-brand text-white'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex h-7 items-center gap-0.5 rounded border border-border px-2 text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
