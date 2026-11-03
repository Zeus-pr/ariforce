'use client';

import type { ReactNode } from 'react';
import { ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@ariforce/ui/lib/utils';

/**
 * Recharts (MIT) in the shadcn/ui chart style (MIT): theme colours via CSS variables,
 * a quiet tooltip card, and no animation when the OS asks for reduced motion.
 */
export const CHART = {
  primary: 'var(--color-primary)',
  muted: 'var(--color-muted-foreground)',
  grid: 'var(--color-border)',
  high: 'var(--color-danger)',
  medium: 'var(--color-warning)',
  low: 'var(--color-chart-4, var(--color-muted-foreground))',
  series: [
    'var(--color-chart-1)',
    'var(--color-chart-2)',
    'var(--color-chart-3)',
    'var(--color-chart-4)',
    'var(--color-chart-5)',
  ],
};

export const axisProps = {
  stroke: 'var(--color-muted-foreground)',
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

export function ChartFrame({
  height = 240,
  className,
  children,
  label,
}: {
  height?: number;
  className?: string;
  children: ReactNode;
  label: string;
}) {
  return (
    <figure
      role="img"
      aria-label={label}
      className={cn('w-full min-w-0', className)}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </figure>
  );
}

type TipProps = {
  active?: boolean;
  label?: string | number;
  payload?: readonly { dataKey?: unknown; name?: unknown; value?: unknown; color?: string }[];
  format?: (v: number) => string;
};

function TooltipCard({ active, payload, label, format }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
      {label != null && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-1.5 tabular-nums">
          <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
          <span className="text-muted-foreground">{String(p.name)}</span>
          <span className="ml-auto pl-3 font-medium">
            {format ? format(Number(p.value)) : String(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function ChartTooltip({ format }: { format?: (v: number) => string }) {
  return (
    <Tooltip
      cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }}
      content={(p) => (
        <TooltipCard
          active={p.active}
          label={p.label as string}
          payload={p.payload as TipProps['payload']}
          format={format}
        />
      )}
    />
  );
}
