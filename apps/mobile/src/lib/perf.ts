import type { KpiKey, KpiReport } from '@ariforce/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { todayIST } from './dcr/dates';
import { formatINR } from './money';
import { isApprover, isDirector } from './roles';

export type KpiRow = KpiReport['rows'][number];
type KpiRollup = KpiReport['rollup'];
type KpiUnit = KpiRow['metrics'][number]['unit'];

const shortMonth = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
const longMonth = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export function monthKey(delta = 0, from = todayIST().slice(0, 7)) {
  const [y, m] = from.split('-').map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const monthTitle = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return longMonth.format(new Date(Date.UTC(y!, (m ?? 1) - 1, 1)));
};

export const monthShort = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return shortMonth.format(new Date(Date.UTC(y!, (m ?? 1) - 1, 1)));
};

/** Widest rollup this person may ask for. Same rule as the website. */
export function kpiRollup(roles: readonly string[]): KpiRollup {
  if (isDirector(roles)) return 'company';
  return isApprover(roles) ? 'team' : 'self';
}

/** Director sees zones, a manager sees people, a business manager sees only the headline. */
export function kpiBreakdown(roles: readonly string[]): 'byTerritory' | 'byUser' | null {
  if (isDirector(roles)) return 'byTerritory';
  return isApprover(roles) ? 'byUser' : null;
}

export const KPI_LABEL: Record<KpiKey, string> = {
  call_average: 'Call average',
  chemist_call_average: 'Chemist call average',
  coverage_pct: 'Coverage',
  frequency_compliance_pct: 'Frequency compliance',
  missed_doctor_pct: 'Missed doctors',
  unique_doctors_seen: 'Doctors seen',
  doctor_visits_per_day: 'Doctor visits a day',
  dcr_compliance_pct: 'DCR compliance',
  dcr_on_time_pct: 'DCR on time',
  tp_adherence_pct: 'Tour plan adherence',
  msl_size: 'Doctors on list',
  pob_value: 'Orders booked',
  pob_achievement_pct: 'Order achievement',
  primary_sales_value: 'Primary sales',
  primary_achievement_pct: 'Primary achievement',
  secondary_sales_value: 'Secondary sales',
  secondary_achievement_pct: 'Secondary achievement',
  growth_vs_ly_pct: 'Growth vs last year',
};

export function formatKpi(unit: KpiUnit, value: number | null) {
  if (value == null) return '—';
  if (unit === 'inr') return formatINR(value);
  if (unit === 'percent') return `${Math.round(value)}%`;
  if (unit === 'ratio') return value.toFixed(1);
  return String(Math.round(value));
}

const keysOf = (kpis: readonly KpiKey[]) => kpis.join(',');

function getReport(
  month: string,
  rollup: KpiRollup,
  kpis: readonly KpiKey[],
  territoryId?: string,
) {
  return apiFetch<KpiReport>('/v1/kpis', {
    query: {
      month,
      rollup,
      kpis: keysOf(kpis),
      ...(territoryId ? { territoryId } : {}),
    },
  });
}

/** The one row for this month. A single request, kept while the month changes. */
export function useKpiHeadline(
  month: string,
  kpis: readonly KpiKey[],
  rollup: KpiRollup,
  enabled = true,
) {
  return useQuery({
    queryKey: ['kpis', 'head', month, rollup, keysOf(kpis)],
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    queryFn: async () => (await getReport(month, rollup, kpis)).rows[0] ?? null,
  });
}

/** People or zones. Runs only after the section is opened. */
export function useKpiBreakdown(
  month: string,
  kpis: readonly KpiKey[],
  breakdown: 'byUser' | 'byTerritory' | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['kpis', 'break', month, breakdown, keysOf(kpis)],
    enabled: enabled && !!breakdown,
    staleTime: 60_000,
    queryFn: async () => {
      let territoryId: string | undefined;
      if (breakdown === 'byTerritory') {
        const page = await apiFetch<{ items: { id: string; parentId: string | null }[] }>(
          '/v1/territories',
          { query: { limit: 200 } },
        );
        territoryId = page.items.find((t) => t.parentId == null)?.id;
      }
      const report = await getReport(month, breakdown!, kpis, territoryId);
      return report.rows.filter((r) => !territoryId || r.territoryId !== territoryId);
    },
  });
}

/** Six month headlines. Runs only after the section is opened. */
export function useKpiTrend(
  month: string,
  kpis: readonly KpiKey[],
  rollup: KpiRollup,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['kpis', 'trend', month, rollup, keysOf(kpis)],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const months = Array.from({ length: 6 }, (_, i) => monthKey(i - 5, month));
      const reports = await Promise.all(months.map((m) => getReport(m, rollup, kpis)));
      return months.map((m, i) => ({ month: m, row: reports[i]?.rows[0] ?? null }));
    },
  });
}
