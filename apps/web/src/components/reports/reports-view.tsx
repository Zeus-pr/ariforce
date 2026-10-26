'use client';

import { BarChart3, ClipboardCheck, IndianRupee, Package, Target } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ProductKpiReport } from '@ariforce/contracts';
import { Card } from '@ariforce/ui/components/card';
import { cn } from '@ariforce/ui/lib/utils';
import { rollupFor } from '@/components/dashboard/dashboard-view';
import { coverageCols, COVERAGE_KPIS } from '@/components/performance/coverage-view';
import {
  exportedAt,
  inr,
  MonthSwitch,
  num,
  pct,
  PerfTable,
  useMonth,
  type PerfCol,
} from '@/components/performance/perf-ui';
import { salesCols, SALES_KPIS } from '@/components/performance/sales-view';
import { breakdownFor, usePerf, val, type Row } from '@/components/performance/use-perf';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady } from '@/lib/api';
import { monthLabel } from '@/lib/period';
import type { Role } from '@/lib/roles';

const ACTIVITY_KPIS = [
  'call_average',
  'chemist_call_average',
  'doctor_visits_per_day',
  'dcr_compliance_pct',
  'dcr_on_time_pct',
  'tp_adherence_pct',
] as const;
const activityCols = (first: string): PerfCol<Row>[] => [
  { header: first, get: (r) => r.label },
  { header: 'Call average', get: (r) => val(r, 'call_average') },
  { header: 'Chemist call avg.', get: (r) => val(r, 'chemist_call_average') },
  { header: 'Doctor visits a day', get: (r) => val(r, 'doctor_visits_per_day') },
  { header: 'DCR compliance', get: (r) => val(r, 'dcr_compliance_pct'), format: pct },
  { header: 'DCR on time', get: (r) => val(r, 'dcr_on_time_pct'), format: pct },
  { header: 'Tour plan adherence', get: (r) => val(r, 'tp_adherence_pct'), format: pct },
];

const REPORTS = [
  {
    id: 'activity',
    title: 'Field activity',
    blurb: 'Call averages, DCR compliance and tour plan adherence.',
    icon: ClipboardCheck,
  },
  {
    id: 'coverage',
    title: 'Doctor coverage',
    blurb: 'MSL coverage, frequency compliance and missed doctors.',
    icon: Target,
  },
  {
    id: 'sales',
    title: 'Sales and targets',
    blurb: 'Primary and secondary sales against target, growth.',
    icon: IndianRupee,
  },
  {
    id: 'products',
    title: 'Product detailing',
    blurb: 'Detailing calls, first position, samples and POB by product.',
    icon: Package,
  },
] as const;
type ReportId = (typeof REPORTS)[number]['id'];

export function ReportsView() {
  const { role } = useRole();
  const month = useMonth();
  const params = useSearchParams();
  const pathname = usePathname();
  const r = (REPORTS.find((x) => x.id === params.get('r'))?.id ?? 'activity') as ReportId;
  if (!month) return <div className="h-96" aria-busy="true" />;
  const href = (id: string) => {
    const s = new URLSearchParams(params.toString());
    s.set('r', id);
    return `${pathname}?${s}`;
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="tablist" aria-label="Reports">
        {REPORTS.map((x) => (
          <Link
            key={x.id}
            href={href(x.id)}
            scroll={false}
            role="tab"
            aria-selected={x.id === r}
            data-testid="report-pick"
          >
            <Card
              className={cn(
                'h-full gap-1 px-4 py-3 shadow-xs transition-colors hover:bg-muted/50',
                x.id === r && 'border-primary ring-1 ring-primary',
              )}
            >
              <x.icon className="size-4 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{x.title}</p>
              <p className="hidden text-xs text-muted-foreground sm:block">{x.blurb}</p>
            </Card>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <BarChart3 className="mr-1 inline size-4 align-text-bottom" aria-hidden />
          {role === 'director'
            ? 'Whole company'
            : breakdownFor(role)
              ? 'Your team'
              : 'Your own numbers'}{' '}
          · each table exports to Excel or PDF
        </p>
        <MonthSwitch month={month} />
      </div>
      {r === 'products' ? (
        <ProductReport role={role} month={month} />
      ) : (
        <KpiReport key={r} id={r} role={role} month={month} />
      )}
      <p className="text-xs text-muted-foreground">
        KPI formulas are drafts, to confirm with Arighna (docs/kpi-definitions.md).
      </p>
    </div>
  );
}

function KpiReport({
  id,
  role,
  month,
}: {
  id: Exclude<ReportId, 'products'>;
  role: Role;
  month: string;
}) {
  const kpis = id === 'activity' ? ACTIVITY_KPIS : id === 'coverage' ? COVERAGE_KPIS : SALES_KPIS;
  const perf = usePerf(role, month, kpis);
  const by = breakdownFor(role);
  const first = by === 'byTerritory' ? 'Zone' : by === 'byUser' ? 'Team member' : 'Name';
  const cols =
    id === 'activity'
      ? activityCols(first)
      : id === 'coverage'
        ? coverageCols(first)
        : salesCols(first);
  const title = REPORTS.find((x) => x.id === id)!.title;
  if (!perf) return <div className="h-64" aria-busy="true" />;
  if (perf.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {perf.error}
      </p>
    );
  // Total row first (the caller's rollup), then the breakdown.
  const rows =
    perf.head && by
      ? [
          { ...perf.head, label: role === 'director' ? 'Company total' : 'Team total' },
          ...perf.rows,
        ]
      : perf.rows;
  return (
    <PerfTable
      testid="report-table"
      title={title}
      description={`${monthLabel(month)}${by ? ', total then breakdown' : ''}.`}
      rows={rows}
      cols={cols}
      exportSpec={{
        title: `${title} report`,
        meta: [
          `${monthLabel(month)} · ${exportedAt()}`,
          id === 'sales'
            ? 'Targets implied from achievement %. KPI formulas are drafts, to confirm with Arighna.'
            : 'KPI formulas are drafts, to confirm with Arighna.',
        ],
        fileName: `ariforce-${id}-${month}`,
      }}
    />
  );
}

function ProductReport({ role, month }: { role: Role; month: string }) {
  const [data, setData] = useState<{ month: string; rows: ProductKpiReport['rows'] } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/kpis/products', {
        params: { query: { month, rollup: rollupFor(role) } as never },
      });
      if (live) setData({ month, rows: r.data?.rows ?? [] });
    })();
    return () => {
      live = false;
    };
  }, [role, month]);
  if (!data || data.month !== month) return <div className="h-64" aria-busy="true" />;
  type P = ProductKpiReport['rows'][number];
  return (
    <PerfTable<P>
      testid="report-table"
      title="Product detailing"
      description={`${monthLabel(month)}. Product names in the mock are placeholders (CONTRACT-GAPS #12).`}
      rows={data.rows}
      cols={[
        { header: 'Product', get: (p) => p.productName },
        { header: 'Detailed calls', get: (p) => p.detailedCalls },
        { header: 'First position', get: (p) => p.firstPositionCalls },
        { header: 'Detailing share', get: (p) => p.detailingSharePct, format: pct },
        { header: 'Samples', get: (p) => p.sampleQty, format: num },
        { header: 'POB qty', get: (p) => p.pobQty, format: num },
        { header: 'POB value', get: (p) => p.pobValue, format: inr },
      ]}
      exportSpec={{
        title: 'Product detailing report',
        meta: [`${monthLabel(month)} · ${exportedAt()}`],
        fileName: `ariforce-products-${month}`,
      }}
    />
  );
}
