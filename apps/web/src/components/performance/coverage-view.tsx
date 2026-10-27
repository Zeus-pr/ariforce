'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from 'recharts';
import { axisProps, CHART, ChartFrame, ChartTooltip } from '@/components/charts/chart';
import { KpiCards } from '@/components/dashboard/dashboard-view';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady } from '@/lib/api';
import { monthLabel } from '@/lib/period';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import {
  ChartCard,
  exportedAt,
  MonthSwitch,
  num,
  pct,
  PerfTable,
  SampleBadge,
  useMonth,
  type PerfCol,
} from './perf-ui';
import { breakdownFor, pick, usePerf, val, type Row } from './use-perf';

export const COVERAGE_KPIS = [
  'coverage_pct',
  'frequency_compliance_pct',
  'missed_doctor_pct',
  'unique_doctors_seen',
  'msl_size',
  'call_average',
] as const;

export const coverageCols = (first: string): PerfCol<Row>[] => [
  { header: first, get: (r) => r.label },
  { header: 'MSL size', get: (r) => val(r, 'msl_size') },
  { header: 'Doctors seen', get: (r) => val(r, 'unique_doctors_seen') },
  { header: 'Coverage', get: (r) => val(r, 'coverage_pct'), format: pct },
  { header: 'Frequency compliance', get: (r) => val(r, 'frequency_compliance_pct'), format: pct },
  { header: 'Missed doctors', get: (r) => val(r, 'missed_doctor_pct'), format: pct },
  { header: 'Call average', get: (r) => val(r, 'call_average'), format: num },
];

const short = (s: string) => (s.length > 12 ? `${s.slice(0, 11)}…` : s);

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
  const reduced = useReducedMotion();
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
          <ChartFrame height={220} label="Coverage over six months">
            <LineChart data={trend} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="name" {...axisProps} />
              <YAxis domain={[0, 100]} unit="%" {...axisProps} />
              <ChartTooltip format={(v) => `${v}%`} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line
                dataKey="coverage"
                name="Coverage"
                stroke={CHART.series[0]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={!reduced}
              />
              <Line
                dataKey="frequency"
                name="Frequency compliance"
                stroke={CHART.series[1]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={!reduced}
              />
            </LineChart>
          </ChartFrame>
        </ChartCard>
        {by ? (
          <ChartCard title={`Coverage by ${first.toLowerCase()}`}>
            <ChartFrame height={220} label={`Coverage by ${first.toLowerCase()}`}>
              <BarChart
                data={bars}
                margin={{ top: 12, right: 12, left: -12, bottom: 0 }}
                barGap={2}
              >
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="name" {...axisProps} interval={0} tickFormatter={short} />
                <YAxis domain={[0, 100]} unit="%" {...axisProps} />
                <ChartTooltip format={(v) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="coverage"
                  name="Coverage"
                  fill={CHART.series[0]}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={!reduced}
                />
                <Bar
                  dataKey="frequency"
                  name="Frequency compliance"
                  fill={CHART.series[1]}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={!reduced}
                />
              </BarChart>
            </ChartFrame>
          </ChartCard>
        ) : (
          <ChartCard title="Coverage by doctor category" badge={<SampleBadge />}>
            <ChartFrame height={220} label="Coverage by doctor category">
              <BarChart
                data={cats ?? []}
                margin={{ top: 12, right: 12, left: -12, bottom: 0 }}
                barSize={32}
              >
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis dataKey="category" {...axisProps} />
                <YAxis domain={[0, 100]} unit="%" {...axisProps} />
                <ChartTooltip format={(v) => `${v}%`} />
                <Bar
                  dataKey="coverage"
                  name="Coverage"
                  fill={CHART.series[0]}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={!reduced}
                />
              </BarChart>
            </ChartFrame>
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
