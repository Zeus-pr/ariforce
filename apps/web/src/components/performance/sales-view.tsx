'use client';

import dynamic from 'next/dynamic';

import { KpiCards } from '@/components/dashboard/kpi-cards';
import { useRole } from '@/components/shell/role-context';
import { monthLabel } from '@/lib/period';
import { MOCK_PRODUCT_SEED } from '@/mocks/product-seed';
import {
  ChartCard,
  exportedAt,
  inr,
  MonthSwitch,
  pct,
  PerfTable,
  SampleBadge,
  useMonth,
} from './perf-ui';
import { breakdownFor, pick, usePerf, val } from './use-perf';
import { impliedTarget, salesCols, SALES_KPIS } from './sales-kpis';

const SalesTrendChart = dynamic(() => import('./sales-charts').then((m) => m.SalesTrendChart), {
  ssr: false,
  loading: () => (
    <div className="h-[240px] animate-pulse rounded-md bg-muted/40" aria-busy="true" />
  ),
});

/** Brand-wise sales vs target. Sample only: no product grain for sales in the contract (CONTRACT-GAPS #19). */
export function brandSample(month: string, total: number | null) {
  const seed = [...month].reduce((h, c) => h * 31 + c.charCodeAt(0), 7);
  const brands = [...new Set(MOCK_PRODUCT_SEED.map((p) => p.name.split(' ')[0]!))].slice(0, 8);
  const weights = brands.map((_, i) => 1 / (i + 1.5));
  const sum = weights.reduce((a, b) => a + b, 0);
  return brands.map((b, i) => {
    const sales = Math.round(((total ?? 500000) * weights[i]!) / sum);
    const ach = 70 + ((seed >> i) % 45);
    return { brand: b, sales, target: Math.round((sales * 100) / ach), ach };
  });
}

export function SalesView() {
  const { role } = useRole();
  const month = useMonth();
  const perf = usePerf(role, month, SALES_KPIS);
  const by = breakdownFor(role);
  if (!month) return <div className="h-96" aria-busy="true" />;
  const first = by === 'byTerritory' ? 'Zone' : by === 'byUser' ? 'Team member' : 'You';
  const trend = (perf?.trend ?? []).map((t) => ({
    name: monthLabel(t.month).slice(0, 3),
    primary: val(t.row, 'primary_sales_value'),
    secondary: val(t.row, 'secondary_sales_value'),
    target: impliedTarget(t.row, 'primary'),
  }));
  const brands = brandSample(month, val(perf?.head, 'secondary_sales_value'));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="perf-scope">
          {role === 'director' ? 'Whole company' : by ? 'Your team' : 'Your own numbers'}
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
          description="Targets are implied from achievement %, until target amounts are in the contract."
          rows={perf.rows}
          cols={salesCols(first)}
          exportSpec={{
            title: 'Sales and targets',
            meta: [
              `${monthLabel(month)} · ${exportedAt()}`,
              'Targets implied from achievement %. KPI formulas are drafts, to confirm with Arighna.',
            ],
            fileName: `ariforce-sales-${month}`,
          }}
        />
      )}
      <PerfTable
        testid="sales-brands"
        title="By brand"
        badge={<SampleBadge />}
        description="Secondary sales split by brand. Illustrative until sales come in by product."
        rows={brands}
        cols={[
          { header: 'Brand', get: (b) => b.brand },
          { header: 'Sales', get: (b) => b.sales, format: inr },
          { header: 'Target', get: (b) => b.target, format: inr },
          { header: 'Achievement', get: (b) => b.ach, format: pct },
        ]}
        exportSpec={{
          title: 'Sales by brand (sample data)',
          meta: [
            `${monthLabel(month)} · ${exportedAt()}`,
            'Sample data: no product grain for sales in the contract yet.',
          ],
          fileName: `ariforce-sales-brands-${month}`,
        }}
      />
      <p className="text-xs text-muted-foreground">
        Sales come from monthly Excel imports (primary from the company, secondary from stockist
        statements). KPI formulas are drafts, to confirm with Arighna.
      </p>
    </div>
  );
}
