'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, XAxis, YAxis } from 'recharts';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { KpiCards } from '@/components/dashboard/dashboard-view';
import { useRole } from '@/components/shell/role-context';
import { monthLabel } from '@/lib/period';
import { useReducedMotion } from '@/lib/use-reduced-motion';
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
  type PerfCol,
} from './perf-ui';
import { breakdownFor, pick, usePerf, val, type Row } from './use-perf';

export const SALES_KPIS = [
  'primary_sales_value',
  'primary_achievement_pct',
  'secondary_sales_value',
  'secondary_achievement_pct',
  'growth_vs_ly_pct',
  'pob_value',
] as const;

/** Target value implied by sales and achievement %; the KPI contract has no target amount (CONTRACT-GAPS #13, #19). */
export function impliedTarget(r: Row | null | undefined, kind: 'primary' | 'secondary') {
  const v = val(r, `${kind}_sales_value`);
  const a = val(r, `${kind}_achievement_pct`);
  return v !== null && a ? Math.round((v * 100) / a) : null;
}

export const salesCols = (first: string): PerfCol<Row>[] => [
  { header: first, get: (r) => r.label },
  { header: 'Primary sales', get: (r) => val(r, 'primary_sales_value'), format: inr },
  { header: 'Primary target', get: (r) => impliedTarget(r, 'primary'), format: inr },
  { header: 'Primary ach.', get: (r) => val(r, 'primary_achievement_pct'), format: pct },
  { header: 'Secondary sales', get: (r) => val(r, 'secondary_sales_value'), format: inr },
  { header: 'Secondary target', get: (r) => impliedTarget(r, 'secondary'), format: inr },
  { header: 'Secondary ach.', get: (r) => val(r, 'secondary_achievement_pct'), format: pct },
  { header: 'Growth vs LY', get: (r) => val(r, 'growth_vs_ly_pct'), format: pct },
];

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
  const reduced = useReducedMotion();
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
  const lakh = (v: number) => `₹${(v / 1e5).toFixed(1)}L`;
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
        <ChartFrame height={240} label="Sales against target, six months">
          <ComposedChart
            data={trend}
            margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
            barGap={2}
          >
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="name" {...axisProps} />
            <YAxis tickFormatter={lakh} {...axisProps} width={56} />
            <ChartTooltip format={inr} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              dataKey="primary"
              name="Primary"
              fill={CHART.series[0]}
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reduced}
            />
            <Bar
              dataKey="secondary"
              name="Secondary"
              fill={CHART.series[1]}
              radius={[3, 3, 0, 0]}
              isAnimationActive={!reduced}
            />
            <Line
              dataKey="target"
              name="Primary target"
              stroke={CHART.muted}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={!reduced}
            />
          </ComposedChart>
        </ChartFrame>
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
