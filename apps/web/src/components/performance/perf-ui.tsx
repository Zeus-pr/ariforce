'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { Button } from '@ariforce/ui/components/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ariforce/ui/components/table';
import { cn } from '@ariforce/ui/lib/utils';
import { ExportMenu } from '@/components/export/export-menu';
import type { ExportCell, ExportSpec } from '@/components/export/export';
import { addMonths, monthLabel, thisMonth } from '@/lib/period';

const noop = () => () => {};

/** Month in the URL (?m=YYYY-MM), defaulting to this month (IST). Null until mounted. */
export function useMonth() {
  const now = useSyncExternalStore(noop, thisMonth, () => null);
  const m = useSearchParams().get('m');
  return now && m && /^\d{4}-\d{2}$/.test(m) && m <= now ? m : now;
}

export function MonthSwitch({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = thisMonth();
  const go = (m: string) => {
    const s = new URLSearchParams(params.toString());
    if (m === now) s.delete('m');
    else s.set('m', m);
    router.push(`${pathname}${s.size ? `?${s}` : ''}`, { scroll: false });
  };
  return (
    <div className="flex items-center gap-1" data-testid="month-switch">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous month"
        onClick={() => go(addMonths(month, -1))}
      >
        <ChevronLeft />
      </Button>
      <span
        className="min-w-28 text-center text-sm font-medium tabular-nums"
        data-testid="month-label"
      >
        {monthLabel(month)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next month"
        disabled={month >= now}
        onClick={() => go(addMonths(month, 1))}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

export type PerfCol<R> = {
  header: string;
  get: (r: R) => ExportCell;
  format?: (v: number) => string;
  width?: number;
};

export const inr = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
export const pct = (v: number) => `${v.toFixed(1)}%`;
export const num = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 1 });

/** Plain table for small, already-aggregated breakdowns, with an Export menu for the same rows. */
export function PerfTable<R>({
  title,
  description,
  rows,
  cols,
  exportSpec,
  testid,
  badge,
  onRow,
}: {
  title: string;
  description?: string;
  rows: R[];
  cols: PerfCol<R>[];
  exportSpec: Omit<ExportSpec, 'columns' | 'rows'>;
  testid: string;
  badge?: React.ReactNode;
  onRow?: (r: R) => void;
}) {
  const spec = (): ExportSpec => ({
    ...exportSpec,
    columns: cols.map((c, i) => ({
      header: c.header,
      width: c.width ?? (i === 0 ? 28 : 16),
      align: i === 0 ? 'left' : 'right',
    })),
    rows: rows.map((r) => cols.map((c) => c.get(r))),
  });
  return (
    <Card className="min-w-0 gap-0 py-0 shadow-xs" data-testid={testid}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 border-b px-4 py-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            {title} {badge}
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <ExportMenu spec={spec} disabled={!rows.length} />
      </CardHeader>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c, i) => (
                <TableHead
                  key={c.header}
                  className={cn(i === 0 ? 'pl-4' : 'text-right', 'last:pr-4')}
                >
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow
                key={i}
                data-testid="perf-row"
                className={cn('af-enter', onRow && 'cursor-pointer')}
                style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                tabIndex={onRow ? 0 : undefined}
                onClick={onRow && (() => onRow(r))}
                onKeyDown={onRow && ((e) => e.key === 'Enter' && onRow(r))}
              >
                {cols.map((c, j) => {
                  const v = c.get(r);
                  return (
                    <TableCell
                      key={c.header}
                      className={cn(
                        j === 0 ? 'pl-4 font-medium' : 'text-right tabular-nums',
                        'last:pr-4',
                      )}
                    >
                      {v === null ? '—' : typeof v === 'number' ? (c.format ?? num)(v) : v}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={cols.length} className="py-8 text-center text-muted-foreground">
                  Nothing for this month.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

export function ChartCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-0 py-0 shadow-xs">
      <CardHeader className="px-4 pt-4 pb-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          {title} {badge}
        </CardTitle>
      </CardHeader>
      <div className="px-2 pb-2">{children}</div>
    </Card>
  );
}

export const exportedAt = () =>
  `exported ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`;
