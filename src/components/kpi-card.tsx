import { cn, isComponentType } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: number | string;
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | 'info';
  unit?: string;
  /** 环比百分比；正数↑，负数↓ */
  delta?: number;
  /**
   * 指标极性，决定 delta 颜色语义：
   * - 'positive'（默认）：升 = 好（绿），降 = 坏（红）
   * - 'negative'：升 = 坏（红），降 = 好（绿），例如「逾期任务」
   * - 'neutral'：始终中性灰
   */
  deltaPolarity?: 'positive' | 'negative' | 'neutral';
  /** delta 的对比基准文案，例如「较昨日」 */
  deltaLabel?: string;
  hint?: string;
  compact?: boolean;
}

const TONE_MAP: Record<NonNullable<KpiCardProps['tone']>, { bg: string; text: string }> = {
  brand: { bg: 'bg-brand/10', text: 'text-brand' },
  success: { bg: 'bg-status-success/12', text: 'text-status-success' },
  warning: { bg: 'bg-status-warning/12', text: 'text-status-warning' },
  danger: { bg: 'bg-status-danger/12', text: 'text-status-danger' },
  neutral: { bg: 'bg-muted', text: 'text-muted-foreground' },
  info: { bg: 'bg-sky-500/12', text: 'text-sky-600' },
};

/**
 * 信息化驾驶舱 KPI 卡片：
 * - 左侧大数字 + 标签
 * - 右侧圆角图标底色块
 * - 可选：单位、环比 delta、底部提示、紧凑模式
 */
export function KpiCard({
  label,
  value,
  icon,
  tone = 'brand',
  unit,
  delta,
  deltaPolarity = 'positive',
  deltaLabel,
  hint,
  compact = false,
}: KpiCardProps) {
  const t = TONE_MAP[tone];
  const isComp = isComponentType(icon);
  const IconNode = isComp ? (icon as React.ComponentType<{ className?: string }>) : null;
  const iconNode = isComp ? null : (icon as React.ReactNode);

  // 按指标极性计算 delta 的色调
  let deltaColor = 'text-muted-foreground';
  if (typeof delta === 'number' && delta !== 0 && deltaPolarity !== 'neutral') {
    const goingUp = delta > 0;
    const good = deltaPolarity === 'positive' ? goingUp : !goingUp;
    deltaColor = good ? 'text-status-success' : 'text-status-danger';
  }

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)]',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span
              className={cn(
                'font-mono font-semibold tabular-nums leading-none text-foreground',
                compact ? 'text-2xl' : 'text-3xl',
              )}
            >
              {value}
            </span>
            {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
          </div>
        </div>
        {icon && (
          <div
            className={cn(
              'flex items-center justify-center rounded-md',
              compact ? 'h-8 w-8' : 'h-10 w-10',
              t.bg,
              t.text,
            )}
          >
            {IconNode ? <IconNode className={compact ? 'h-4 w-4' : 'h-5 w-5'} /> : iconNode}
          </div>
        )}
      </div>
      {(typeof delta === 'number' || hint || deltaLabel) && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {typeof delta === 'number' && delta !== 0 && (
            <span className={cn('inline-flex items-center gap-0.5 font-mono font-medium', deltaColor)}>
              {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {delta > 0 ? '+' : ''}
              {delta}%
            </span>
          )}
          {deltaLabel && <span className="text-muted-foreground/80">{deltaLabel}</span>}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </div>
  );
}
