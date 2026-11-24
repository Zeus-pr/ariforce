import type { MouseEvent, ReactNode } from 'react';
import { cn } from '@ariforce/ui/lib/utils';
import type { HeatmapColumn } from '@/components/charts/heatmap/heatmap-context';
import {
  getHeatmapWeekCount,
  getHeatmapWeekStartSunday,
} from '@/components/charts/heatmap/heatmap-utils';

/** Bklit series colours. They live on the chart tokens, not the navy and teal brand pair. */
export const SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
] as const;

export function ChartFrame({
  height,
  className,
  children,
  label,
  rows,
}: {
  height?: number;
  className?: string;
  children: ReactNode;
  label: string;
  rows?: { name: string; cells: { label: string; value: string }[] }[];
}) {
  const headers = rows?.[0]?.cells.map((cell) => cell.label) ?? [];
  return (
    <figure
      role="img"
      aria-label={label}
      className={cn('relative w-full min-w-0 overflow-hidden', className)}
      style={height ? { height } : undefined}
    >
      {children}
      {rows && rows.length > 0 && (
        <table className="sr-only">
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              {headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                {row.cells.map((cell) => (
                  <td key={cell.label}>{cell.value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A calendar month as a midday date, so a time-series chart lands on that month. */
export function monthDate(month: string | undefined, name: string) {
  if (month && /^\d{4}-\d{2}/.test(month)) return new Date(`${month.slice(0, 7)}-15T12:00:00`);
  const index = MONTHS.indexOf(name.slice(0, 3));
  return new Date(new Date().getFullYear(), index < 0 ? 0 : index, 15, 12);
}

export function chartIndex(event: MouseEvent<HTMLElement>, count: number, axis: 'x' | 'y') {
  if (count <= 0) return -1;
  const rect = event.currentTarget.getBoundingClientRect();
  const span = axis === 'x' ? rect.width : rect.height;
  const pad = span * 0.08;
  const pos = (axis === 'x' ? event.clientX - rect.left : event.clientY - rect.top) - pad;
  const ratio = span - pad * 2 > 0 ? pos / (span - pad * 2) : 0;
  return Math.min(count - 1, Math.max(0, Math.floor(ratio * count)));
}

function dayKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** One column per week, Sunday to Saturday, for a Bklit contribution heatmap. */
export function contributionColumns(isoDates: string[], from: Date, to: Date): HeatmapColumn[] {
  const start = getHeatmapWeekStartSunday(from);
  const weeks = Math.max(1, getHeatmapWeekCount(start, to));
  const counts = new Map<string, number>();
  for (const iso of isoDates) {
    const key = iso.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: weeks }, (_, week) => ({
    bin: week,
    bins: Array.from({ length: 7 }, (__, day) => {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      date.setHours(12, 0, 0, 0);
      return { bin: day, count: counts.get(dayKey(date)) ?? 0, date };
    }),
  }));
}
