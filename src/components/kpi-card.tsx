import { cn } from '@/lib/utils';
import type { LucideIcon, LucideTrendingUp, LucideTrendingDown } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
  unit?: string;
  delta?: number;
  hint?: string;
}

const TONE_MAP: Record<NonNullable<KpiCardProps['tone']>, { bg: string; text: string }> = {
  brand: { bg: 'bg-brand/10', text: 'text-brand' },
  success: { bg: 'bg-status-success/12', text: 'text-status-success' },
  warning: { bg: 'bg-status-warning/12', text: 'text-status-warning' },
  danger: { bg: 'bg-status-danger/12', text: 'text-status-danger' },
  neutral: { bg: 'bg-muted', text: 'text-muted-foreground' },
};

/**
 * 信息化驾驶舱 KPI 卡片：
 * - 左侧大数字 + 标签
 * - 右侧圆角图标底色块
 * - 可选：单位、环比 delta、底部提示
 */
export function KpiCard({ label, value, icon: Icon, tone = 'brand', unit, delta, hint }: KpiCardProps) {
  const t = TONE_MAP[tone];
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-mono text-3xl font-semibold tabular-nums leading-none text-foreground">
              {value}
            </span>
            {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
          </div>
        </div>
        {Icon && (
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-md', t.bg, t.text)}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      {(typeof delta === 'number' || hint) && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {typeof delta === 'number' && delta !== 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-mono font-medium',
                delta > 0 ? 'text-status-success' : 'text-status-danger',
              )}
            >
              {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {delta > 0 ? '+' : ''}
              {delta}%
            </span>
          )}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </div>
  );
}
