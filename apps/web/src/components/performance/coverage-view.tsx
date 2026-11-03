'use client';

import dynamic from 'next/dynamic';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady } from '@/lib/api';
import { monthLabel } from '@/lib/period';
import {
  ChartCard,
  exportedAt,
  MonthSwitch,
  pct,
  PerfTable,
  SampleBadge,
  useMonth,
} from './perf-ui';
import { breakdownFor, pick, usePerf, val } from './use-perf';
import { coverageCols, COVERAGE_KPIS } from './coverage-kpis';

const CoverageTrendChart = dynamic(
  () => import('./coverage-charts').then((m) => m.CoverageTrendChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[220px] animate-pulse rounded-md bg-muted/40" aria-busy="true" />
    ),
  },
);
const CoverageBarsChart = dynamic(
  () => import('./coverage-charts').then((m) => m.CoverageBarsChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[220px] animate-pulse rounded-md bg-muted/40" aria-busy="true" />
    ),
  },
);
const CategoryChart = dynamic(() => import('./coverage-charts').then((m) => m.CategoryChart), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] animate-pulse rounded-md bg-muted/40" aria-busy="true" />
  ),
});

/** Coverage by doctor category. No contract (CONTRACT-GAPS #19): sample split of the headline coverage over the real categories. */
function useCategorySample(coverage: number | null) {
  const [cats, setCats] = useState<{ name: string; norm: number }[] | null>(null);
  useEffect(() => {
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/doctor-categories', { params: { query: { limit: 200 } } });
      setCats(
        (r.data?.items ?? [])
          .filter((c) => !c.deletedAt)
          .map((c) => ({ name: c.name, norm: c.visitsPerMonth })),
      );
    })().catch(() => {});
  }, []);
  if (!cats || coverage === null) return null;
  return cats.map((c, i) => ({
    category: c.name,
    norm: c.norm,
    coverage: Math.max(0, Math.min(100, Math.round(coverage + 8 - i * 7))),
  }));
}

export function CoverageView() {
  const { role } = useRole();
  const month = useMonth();
  const perf = usePerf(role, month, COVERAGE_KPIS);
  const by = breakdownFor(role);
  const cats = useCategorySample(val(perf?.head, 'coverage_pct'));
  if (!month) return <div className="h-96" aria-busy="true" />;
  const first = by === 'byTerritory' ? 'Zone' : by === 'byUser' ? 'Team member' : 'You';
  const trend = (perf?.trend ?? []).map((t) => ({
    name: monthLabel(t.month).slice(0, 3),
    coverage: val(t.row, 'coverage_pct'),
    frequency: val(t.row, 'frequency_compliance_pct'),
  }));
  const bars = (perf?.rows ?? []).map((r) => ({
    name: r.label,
    coverage: val(r, 'coverage_pct'),
    frequency: val(r, 'frequency_compliance_pct'),
  }));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="perf-scope">
          {role === 'director' ? 'Whole company' : by ? 'Your team' : 'Your own numbers'}
        </p>
        <MonthSwitch month={month} />
      </div>
      <KpiCards
        metrics={COVERAGE_KPIS.slice(0, 5)
          .map((k) => pick(perf?.head, k))
          .filter((m) => !!m)}
        error={perf?.error ?? null}
        loading={!perf}
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="Coverage over six months">
          <CoverageTrendChart trend={trend} />
        </ChartCard>
        {by ? (
          <ChartCard title={`Coverage by ${first.toLowerCase()}`}>
            <CoverageBarsChart bars={bars} label={`Coverage by ${first.toLowerCase()}`} />
          </ChartCard>
        ) : (
          <ChartCard title="Coverage by doctor category" badge={<SampleBadge />}>
            <CategoryChart cats={cats ?? []} />
          </ChartCard>
        )}
      </div>
      {perf && (
        <PerfTable
          testid="coverage-table"
          title={by ? `By ${first.toLowerCase()}` : 'Your coverage'}
          description="Must-see list (MSL) doctors for the month."
          rows={perf.rows}
          cols={coverageCols(first)}
          exportSpec={{
            title: 'Coverage',
            meta: [
              `${monthLabel(month)} · ${exportedAt()}`,
              'KPI formulas are drafts, to confirm with Arighna.',
            ],
            fileName: `ariforce-coverage-${month}`,
          }}
        />
      )}
      {by && cats && (
        <PerfTable
          testid="coverage-category"
          title="By doctor category"
          description="Visit norm per month from the category master."
          badge={<SampleBadge />}
          rows={cats}
          cols={[
            { header: 'Category', get: (c) => c.category },
            { header: 'Visits a month', get: (c) => c.norm },
            { header: 'Coverage', get: (c) => c.coverage, format: pct },
          ]}
          exportSpec={{
            title: 'Coverage by doctor category (sample data)',
            meta: [
              `${monthLabel(month)} · ${exportedAt()}`,
              'Sample data: no category breakdown in the KPI contract yet.',
            ],
            fileName: `ariforce-coverage-category-${month}`,
          }}
        />
      )}
      <p className="text-xs text-muted-foreground">
        KPI formulas are drafts, to confirm with Arighna. Doctors with no visit this month are
        listed in{' '}
        <Link href="/exceptions?f.category=coverage" className="underline underline-offset-4">
          Exceptions
        </Link>
        .
      </p>
    </div>
  );
}
