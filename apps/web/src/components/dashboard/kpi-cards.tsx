'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { KpiReport } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { NumberTicker } from '@ariforce/ui/components/number-ticker';
import { cn } from '@ariforce/ui/lib/utils';
import { formatKpi, HEADLINE, KPI_META } from './kpi-meta';

type Metric = KpiReport['rows'][number]['metrics'][number];

export function KpiCards({
  metrics,
  error,
  loading,
}: {
  metrics: Metric[];
  error: string | null;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  return (
    <section aria-label="Key metrics" className="flex flex-col gap-2">
      <ul
        data-testid="kpi-cards"
        className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card sm:grid-cols-4 [&>li]:border-b [&>li]:border-r"
      >
        {(loading ? HEADLINE.map((k) => ({ kpi: k }) as Partial<Metric>) : metrics).map((m, i) => {
          const meta = KPI_META[m.kpi!];
          const ready = 'unit' in m;
          const met = ready && m.target != null && m.value != null ? m.value >= m.target : null;
          return (
            <li
              key={m.kpi}
              data-testid="kpi-card"
              data-kpi={m.kpi}
              style={{ '--i': i } as React.CSSProperties}
              className="af-enter -mb-px -mr-px min-w-0 px-4 py-3.5"
              title={
                ready
                  ? `${meta.num}${meta.den ? ` ÷ ${meta.den}` : ''} (to confirm with Arighna)`
                  : undefined
              }
            >
              <p className="truncate text-xs font-medium text-muted-foreground">{meta.label}</p>
              <div className="mt-1 h-8 text-2xl font-semibold tracking-tight tabular-nums sm:text-[28px]">
                {!ready ? (
                  <span className="inline-block h-6 w-16 animate-pulse rounded bg-muted" />
                ) : m.value === null ? (
                  '—'
                ) : m.unit === 'inr' ? (
                  formatKpi(m.value ?? null, 'inr')
                ) : (
                  <NumberTicker
                    value={m.value!}
                    decimalPlaces={m.unit === 'count' ? 0 : 1}
                    suffix={m.unit === 'percent' ? '%' : ''}
                  />
                )}
              </div>
              {ready && (
                <p className="mt-1 text-xs">
                  {m.target == null ? (
                    <span className="text-muted-foreground">No target set</span>
                  ) : (
                    <span className={cn(met ? 'text-success' : 'text-warning-text')}>
                      Target {formatKpi(m.target, m.unit!)}
                    </span>
                  )}
                </p>
              )}
              {ready && open && (
                <p
                  className="af-fade mt-2 text-xs leading-snug text-muted-foreground"
                  data-testid="kpi-formula"
                >
                  {m.denominator != null ? (
                    <>
                      <span className="tabular-nums text-foreground">
                        {formatKpi(m.numerator!, 'count')}
                      </span>{' '}
                      {meta.num}
                      <br />÷{' '}
                      <span className="tabular-nums text-foreground">
                        {formatKpi(m.denominator, 'count')}
                      </span>{' '}
                      {meta.den}
                    </>
                  ) : (
                    <>Count of {meta.num}</>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="kpi-expand"
      >
        <ChevronDown
          className={cn(
            'transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
        {open ? 'Hide how each number is worked out' : 'Show how each number is worked out'}
      </Button>
    </section>
  );
}
