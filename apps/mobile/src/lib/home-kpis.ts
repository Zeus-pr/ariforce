import type { KpiKey } from '@ariforce/contracts';
import { monthKey, useKpiHeadline, kpiRollup, formatKpi, type KpiRow } from '@/lib/perf';
import { isSalesRole } from '@/lib/roles';

/** The four home cards. Seen and list size are fetched only to caption coverage. */
export const HOME_KPI_KEYS = [
  'call_average',
  'coverage_pct',
  'chemist_call_average',
  'dcr_on_time_pct',
  'unique_doctors_seen',
  'msl_size',
] as const satisfies readonly KpiKey[];

export type HomeKpiCard = {
  key: KpiKey;
  label: string;
  value: string;
  target: string;
  /** 0..1 when the figure is a percent of a whole. Null when there is no target to fill. */
  progress: number | null;
};

type Metric = KpiRow['metrics'][number];

const find = (metrics: Metric[], key: KpiKey) => metrics.find((m) => m.kpi === key);

const percentProgress = (value: number | null | undefined) =>
  value == null ? null : Math.min(1, Math.max(0, value / 100));

/** Four cards from one KPI row. Missing figures stay as a dash, never a sample number. */
export function homeKpiCards(metrics: Metric[]): HomeKpiCard[] {
  const call = find(metrics, 'call_average');
  const coverage = find(metrics, 'coverage_pct');
  const chemist = find(metrics, 'chemist_call_average');
  const onTime = find(metrics, 'dcr_on_time_pct');
  const seen = find(metrics, 'unique_doctors_seen')?.value;
  const list = find(metrics, 'msl_size')?.value;
  const coverageTarget =
    seen != null && list != null
      ? `${Math.round(seen)} of ${Math.round(list)} doctors`
      : 'Doctors on the list';
  const onTimeTarget =
    onTime?.numerator != null && onTime.denominator
      ? `${Math.round(onTime.numerator)} of ${Math.round(onTime.denominator)} submitted`
      : 'Of submitted DCRs';
  return [
    {
      key: 'call_average',
      label: 'Call Avg',
      value: call ? formatKpi(call.unit, call.value) : '—',
      target: 'Doctor calls per field day',
      progress: null,
    },
    {
      key: 'coverage_pct',
      label: 'Coverage',
      value: coverage ? formatKpi(coverage.unit, coverage.value) : '—',
      target: coverageTarget,
      progress: percentProgress(coverage?.value),
    },
    {
      key: 'chemist_call_average',
      label: 'Chemist Calls',
      value: chemist ? formatKpi(chemist.unit, chemist.value) : '—',
      target: 'Chemist calls per field day',
      progress: null,
    },
    {
      key: 'dcr_on_time_pct',
      label: 'DCR On-Time',
      value: onTime ? formatKpi(onTime.unit, onTime.value) : '—',
      target: onTimeTarget,
      progress: percentProgress(onTime?.value),
    },
  ];
}

/** This month, for the widest rollup this person may see. */
export function useHomeKpis(roles: readonly string[]) {
  const q = useKpiHeadline(monthKey(), HOME_KPI_KEYS, kpiRollup(roles), isSalesRole(roles));
  return {
    cards: homeKpiCards(q.data?.metrics ?? []),
    pending: q.isPending && isSalesRole(roles),
    error: q.isError,
    refetch: q.refetch,
  };
}
