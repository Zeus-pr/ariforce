'use client';

import Link from 'next/link';
import { salesTarget } from '@/components/performance/sales-kpis';
import { SalesTrendChart } from '@/components/performance/sales-charts';
import { SALES_KPIS } from '@/components/performance/sales-kpis';
import { usePerf, val } from '@/components/performance/use-perf';
import { monthLabel } from '@/lib/period';
import type { Role } from '@/lib/roles';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function sum(rows: NonNullable<ReturnType<typeof usePerf>>['trend'], kpi: string) {
  return rows.reduce((total, item) => total + (val(item.row, kpi) ?? 0), 0);
}

export function DistributionDashboard({ role, month }: { role: Role; month: string }) {
  const year = Number(month.slice(0, 4));
  const current = usePerf(role, month, SALES_KPIS, 0, 12);
  const previous = usePerf(role, `${year - 1}-12`, SALES_KPIS, 0, 12);
  const head = current?.head ?? null;
  const trend = (current?.trend ?? []).map((t) => ({
    name: monthLabel(t.month).slice(0, 3),
    primary: val(t.row, 'primary_sales_value'),
    secondary: val(t.row, 'secondary_sales_value'),
    target: salesTarget(t.row, 'primary'),
  }));
  const cards = [
    { label: 'Primary this month', value: val(head, 'primary_sales_value') },
    { label: 'Secondary this month', value: val(head, 'secondary_sales_value') },
    {
      label: 'Primary, last 12 months',
      value: current ? sum(current.trend, 'primary_sales_value') : null,
    },
    {
      label: 'Secondary, last 12 months',
      value: current ? sum(current.trend, 'secondary_sales_value') : null,
    },
    {
      label: `Primary ${year - 1}`,
      value: previous ? sum(previous.trend, 'primary_sales_value') : null,
    },
    {
      label: `Secondary ${year - 1}`,
      value: previous ? sum(previous.trend, 'secondary_sales_value') : null,
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Whole company · {monthLabel(month)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Distribution</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Primary is what the company sells in. Secondary is what stockists sell out.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/sales" className="rounded-md border px-3 py-2 hover:bg-muted">
            Sales
          </Link>
          <Link href="/aws-ss" className="rounded-md border px-3 py-2 hover:bg-muted">
            AWS & SS
          </Link>
        </div>
      </div>
      {current?.error && (
        <p role="alert" className="text-sm text-destructive">
          {current.error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border bg-card px-4 py-3">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {card.value == null ? '—' : inr.format(card.value)}
            </p>
          </div>
        ))}
      </div>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Month by month</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Primary and secondary for the last 12 months.
        </p>
        <div className="mt-2">
          <SalesTrendChart trend={trend} />
        </div>
      </section>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-medium">Year by year</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <YearTotal
            year={year}
            primary={current ? sum(current.trend, 'primary_sales_value') : null}
            secondary={current ? sum(current.trend, 'secondary_sales_value') : null}
          />
          <YearTotal
            year={year - 1}
            primary={previous ? sum(previous.trend, 'primary_sales_value') : null}
            secondary={previous ? sum(previous.trend, 'secondary_sales_value') : null}
          />
        </div>
      </section>
      {current && current.rows.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-medium">Places</h2>
          <div className="mt-3 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Place</th>
                  <th className="text-right">Primary</th>
                  <th className="text-right">Secondary</th>
                </tr>
              </thead>
              <tbody>
                {current.rows.map((row) => (
                  <tr key={row.territoryId ?? row.label} className="border-t">
                    <td className="py-2">{row.label}</td>
                    <td className="text-right tabular-nums">
                      {val(row, 'primary_sales_value') == null
                        ? '—'
                        : inr.format(val(row, 'primary_sales_value')!)}
                    </td>
                    <td className="text-right tabular-nums">
                      {val(row, 'secondary_sales_value') == null
                        ? '—'
                        : inr.format(val(row, 'secondary_sales_value')!)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function YearTotal({
  year,
  primary,
  secondary,
}: {
  year: number;
  primary: number | null;
  secondary: number | null;
}) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-sm font-medium">{year}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Primary{' '}
        <span className="font-medium text-foreground">
          {primary == null ? '—' : inr.format(primary)}
        </span>
      </p>
      <p className="text-sm text-muted-foreground">
        Secondary{' '}
        <span className="font-medium text-foreground">
          {secondary == null ? '—' : inr.format(secondary)}
        </span>
      </p>
    </div>
  );
}
