import type { KpiKey } from '@ariforce/contracts';

/**
 * Labels and plain-language formulas from docs/kpi-definitions.md.
 * Every formula is a draft: to confirm with Arighna.
 */
export const KPI_META: Record<KpiKey, { label: string; num: string; den?: string; higherIsBetter?: boolean }> = {
  call_average: { label: 'Call average', num: 'doctor calls on field days', den: 'field days' },
  chemist_call_average: { label: 'Chemist call average', num: 'chemist calls on field days', den: 'field days' },
  coverage_pct: { label: 'Coverage', num: 'MSL doctors visited at least once', den: 'MSL size' },
  frequency_compliance_pct: { label: 'Frequency compliance', num: 'MSL doctors seen as often as required', den: 'MSL size' },
  missed_doctor_pct: { label: 'Missed doctors', num: 'MSL doctors with no visit', den: 'MSL size', higherIsBetter: false },
  unique_doctors_seen: { label: 'Unique doctors seen', num: 'distinct MSL doctors visited' },
  doctor_visits_per_day: { label: 'Doctor visits per day', num: 'doctor calls', den: 'field days' },
  dcr_compliance_pct: { label: 'DCR compliance', num: 'days with a DCR submitted', den: 'expected working days' },
  dcr_on_time_pct: { label: 'DCR on time', num: 'DCRs submitted by end of next day (IST)', den: 'submitted DCRs' },
  tp_adherence_pct: { label: 'Tour plan adherence', num: 'planned visits with a matching call', den: 'planned visits in the approved plan' },
  msl_size: { label: 'MSL size', num: 'doctors on the must-see list' },
  pob_value: { label: 'POB value', num: 'order value booked in calls' },
  pob_achievement_pct: { label: 'POB achievement', num: 'POB value', den: 'POB target' },
  primary_sales_value: { label: 'Primary sales', num: 'primary sales, net of returns' },
  primary_achievement_pct: { label: 'Primary achievement', num: 'primary sales', den: 'primary target' },
  secondary_sales_value: { label: 'Secondary sales', num: 'secondary sales' },
  secondary_achievement_pct: { label: 'Secondary achievement', num: 'secondary sales', den: 'secondary target' },
  growth_vs_ly_pct: { label: 'Growth vs last year', num: 'this month minus same month last year', den: 'same month last year' },
};

/** Headline cards, in order. */
export const HEADLINE: KpiKey[] = [
  'call_average',
  'coverage_pct',
  'frequency_compliance_pct',
  'dcr_compliance_pct',
  'tp_adherence_pct',
  'missed_doctor_pct',
  'pob_value',
  'secondary_achievement_pct',
];

/** Columns of the team table. */
export const TEAM_COLUMNS: KpiKey[] = ['call_average', 'coverage_pct', 'missed_doctor_pct', 'dcr_on_time_pct', 'tp_adherence_pct'];

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

export function formatKpi(value: number | null, unit: 'count' | 'ratio' | 'percent' | 'inr') {
  if (value === null) return '—';
  if (unit === 'inr') return inr.format(value);
  if (unit === 'percent') return `${num.format(value)}%`;
  return num.format(value);
}
