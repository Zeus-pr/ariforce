'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

import { Button } from '@ariforce/ui/components/button';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { useRole } from '@/components/shell/role-context';
import { monthLabel } from '@/lib/period';
import { ChartCard, exportedAt, MonthSwitch, PerfTable, useMonth } from './perf-ui';
import { can } from '@/components/exceptions/model';
import { isApprover, isFieldRole } from '@/lib/roles';
import { PlaceDesk } from './place-desk';
import { SalesManage } from './sales-manage';
import { breakdownFor, pick, usePerf, val } from './use-perf';
import { salesTarget, salesCols, SALES_KPIS } from './sales-kpis';

const SalesTrendChart = dynamic(() => import('./sales-charts').then((m) => m.SalesTrendChart), {
  ssr: false,
  loading: () => (
    <div className="h-[240px] animate-pulse rounded-md bg-muted/40" aria-busy="true" />
  ),
});

export function SalesView() {
  const { role } = useRole();
  const month = useMonth();
  const [rev, setRev] = useState(0);
  const perf = usePerf(role, month, SALES_KPIS, rev);
  const by = breakdownFor(role);
  const [targets, setTargets] = useState(false);
  const mayWrite = can(role, 'sales:write');
  if (!month) return <div className="h-96" aria-busy="true" />;
  if (role === 'distribution_head' || isApprover(role) || isFieldRole(role)) {
    return (
      <div className="flex flex-col gap-6">
        <PlaceDesk
          title="Sales"
          reload={rev}
          headerExtra={
            mayWrite ? (
              <Button type="button" onClick={() => setTargets((v) => !v)}>
                {targets ? 'Hide targets' : 'Set targets'}
              </Button>
            ) : undefined
          }
        />
        {mayWrite && targets && <SalesManage onChanged={() => setRev((n) => n + 1)} />}
      </div>
    );
  }
  const first = by === 'byTerritory' ? 'Zone' : by === 'byUser' ? 'Team member' : 'You';
  const trend = (perf?.trend ?? []).map((t) => ({
    name: monthLabel(t.month).slice(0, 3),
    primary: val(t.row, 'primary_sales_value'),
    secondary: val(t.row, 'secondary_sales_value'),
    target: salesTarget(t.row, 'primary'),
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
      />
      <ChartCard title="Sales against target, six months">
        <SalesTrendChart trend={trend} />
      </ChartCard>
      {perf && (
        <PerfTable
          testid="sales-table"
          title={by ? `By ${first.toLowerCase()}` : 'Your sales'}
          description="Targets are the amounts the Director set under Targets and actuals."
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
      {mayWrite && (
        <div className="flex flex-col gap-4">
          <Button type="button" variant="outline" onClick={() => setTargets((v) => !v)}>
            {targets ? 'Hide targets' : 'Set targets'}
          </Button>
          {targets && <SalesManage onChanged={() => setRev((n) => n + 1)} />}
        </div>
      )}
    </div>
  );
}
