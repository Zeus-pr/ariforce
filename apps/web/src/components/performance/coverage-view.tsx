'use client';

import dynamic from 'next/dynamic';

import Link from 'next/link';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { useRole } from '@/components/shell/role-context';
import { monthLabel } from '@/lib/period';
import { ChartCard, exportedAt, MonthSwitch, PerfTable, useMonth } from './perf-ui';
import { breakdownFor, pick, usePerf, val } from './use-perf';
import { CoverageRadar, CoverageRings } from './coverage-charts';
import { coverageCols, COVERAGE_KPIS } from './coverage-kpis';
import { DeskPageSkeleton } from '@/components/shell/page-skeletons';

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

export function CoverageView() {
  const { role } = useRole();
  const month = useMonth();
  const perf = usePerf(role, month, COVERAGE_KPIS);
  const by = breakdownFor(role);
  if (!month) return <DeskPageSkeleton embedded />;
  const first = by === 'byTerritory' ? 'Zone' : by === 'byUser' ? 'Team member' : 'You';
  const trend = (perf?.trend ?? []).map((t) => ({
    name: monthLabel(t.month).slice(0, 3),
    month: t.month,
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
        sparklines={{
          coverage_pct: {
            values: trend.map((point) => point.coverage ?? 0),
            color: 'var(--chart-1)',
          },
          frequency_compliance_pct: {
            values: trend.map((point) => point.frequency ?? 0),
            color: 'var(--chart-6)',
          },
        }}
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="This month">
          <CoverageRings
            coverage={val(perf?.head, 'coverage_pct')}
            frequency={val(perf?.head, 'frequency_compliance_pct')}
            missed={val(perf?.head, 'missed_doctor_pct')}
          />
        </ChartCard>
        <ChartCard title="The shape of the month">
          <CoverageRadar
            coverage={val(perf?.head, 'coverage_pct')}
            frequency={val(perf?.head, 'frequency_compliance_pct')}
            missed={val(perf?.head, 'missed_doctor_pct')}
          />
        </ChartCard>
      </div>
      <div className={by ? 'grid grid-cols-1 gap-5 lg:grid-cols-2' : 'grid grid-cols-1 gap-5'}>
        <ChartCard title="Coverage over six months">
          <CoverageTrendChart trend={trend} />
        </ChartCard>
        {by && (
          <ChartCard title={`Coverage by ${first.toLowerCase()}`}>
            <CoverageBarsChart bars={bars} label={`Coverage by ${first.toLowerCase()}`} />
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
