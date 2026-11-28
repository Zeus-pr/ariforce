'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import { Button } from '@ariforce/ui/components/button';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { useRole } from '@/components/shell/role-context';
import { monthLabel } from '@/lib/period';
import { ChartCard, exportedAt, MonthSwitch, PerfTable, useMonth } from './perf-ui';
import { can } from '@/components/exceptions/model';
import { isApprover, isFieldRole } from '@/lib/roles';
import { PlaceDesk } from './place-desk';
import { SalesSkeleton } from './sales-skeleton';
import { breakdownFor, pick, usePerf, val } from './use-perf';
import { SalesGauges } from './sales-charts';
import { salesTarget, salesCols, SALES_KPIS } from './sales-kpis';

function SetTargetsButton() {
  const router = useRouter();
  return (
    <Button type="button" onClick={() => router.push('/sales/targets')}>
      Set targets
    </Button>
  );
}

const SalesTrendChart = dynamic(() => import('./sales-charts').then((m) => m.SalesTrendChart), {
  ssr: false,
  loading: () => (
    <div className="h-[240px] animate-pulse rounded-md bg-muted/40" aria-busy="true" />
  ),
});

export function SalesView() {
  const { role } = useRole();
  const month = useMonth();
  const perf = usePerf(role, month, SALES_KPIS);
  const by = breakdownFor(role);
  const mayWrite = can(role, 'sales:write');
  if (!month) return <SalesSkeleton />;
  if (role === 'distribution_head' || isApprover(role) || isFieldRole(role)) {
    return (
      <div className="flex flex-col gap-6">
        <PlaceDesk title="Sales" headerExtra={mayWrite ? <SetTargetsButton /> : undefined} />
      </div>
    );
  }
  const first = by === 'byTerritory' ? 'Zone' : by === 'byUser' ? 'Team member' : 'You';
  const trend = (perf?.trend ?? []).map((t) => ({
    name: monthLabel(t.month).slice(0, 3),
    month: t.month,
    primary: val(t.row, 'primary_sales_value'),
    secondary: val(t.row, 'secondary_sales_value'),
    target: salesTarget(t.row, 'primary'),
    secondaryTarget: salesTarget(t.row, 'secondary'),
  }));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="perf-scope">
          {by ? 'Your team' : 'Your own numbers'}
        </p>
        <MonthSwitch month={month} />
      </div>
      <KpiCards
        metrics={SALES_KPIS.slice(0, 5)
          .map((k) => pick(perf?.head, k))
          .filter((m) => !!m)}
        error={perf?.error ?? null}
        loading={!perf}
        sparklines={{
          primary_sales_value: {
            values: trend.map((point) => point.primary ?? 0),
            color: 'var(--chart-1)',
          },
          secondary_sales_value: {
            values: trend.map((point) => point.secondary ?? 0),
            color: 'var(--chart-7)',
          },
        }}
      />
      <SalesGauges
        primary={val(perf?.head, 'primary_sales_value') ?? 0}
        primaryTarget={salesTarget(perf?.head, 'primary') ?? 0}
        secondary={val(perf?.head, 'secondary_sales_value') ?? 0}
        secondaryTarget={salesTarget(perf?.head, 'secondary') ?? 0}
      />
      <ChartCard title="Sales against target, six months">
        <SalesTrendChart trend={trend} />
      </ChartCard>
      {perf && (
        <PerfTable
          testid="sales-table"
          title={by ? `By ${first.toLowerCase()}` : 'Your sales'}
          description="Targets are the monthly amounts set for each headquarters."
          rows={perf.rows}
          cols={salesCols(first)}
          exportSpec={{
            title: 'Sales and targets',
            meta: [
              `${monthLabel(month)} · ${exportedAt()}`,
              'Targets as set by the Director. KPI formulas are drafts, to confirm with Arighna.',
            ],
            fileName: `ariforce-sales-${month}`,
          }}
        />
      )}
      {mayWrite && <SetTargetsButton />}
    </div>
  );
}
