'use client';

import type { TooltipProps } from 'recharts';

// 图表配色，与 globals.css 中 --chart-1 ~ --chart-5 对齐
export const CHART_COLORS = [
  'var(--chart-1, #1677FF)',
  'var(--chart-2, #13C2C2)',
  'var(--chart-3, #52C41A)',
  'var(--chart-4, #FA8C16)',
  'var(--chart-5, #722ED1)',
];

type PayloadItem = {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
};

export function ChartTooltipContent(props: TooltipProps<number, string>) {
  const { active, payload, label } = props as unknown as {
    active?: boolean;
    payload?: PayloadItem[];
    label?: React.ReactNode;
  };
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      {label !== undefined && label !== null && label !== '' && (
        <div className="mb-1 text-[11px] font-medium text-foreground/80">{label}</div>
      )}
      <div className="space-y-0.5">
        {payload.map((p, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto font-mono font-medium text-foreground">
              {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

