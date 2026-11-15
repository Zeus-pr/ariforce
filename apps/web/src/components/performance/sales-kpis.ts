import { inr, pct, type PerfCol } from './perf-ui';
import { val, type Row } from './use-perf';

export const SALES_KPIS = [
  'primary_sales_value',
  'primary_achievement_pct',
  'secondary_sales_value',
  'secondary_achievement_pct',
  'growth_vs_ly_pct',
  'pob_value',
] as const;

/** Target amount set by the Director (Sales > Targets); null while none is set for the period. */
export function salesTarget(r: Row | null | undefined, kind: 'primary' | 'secondary') {
  return r?.metrics.find((m) => m.kpi === `${kind}_sales_value`)?.target ?? null;
}

export const salesCols = (first: string): PerfCol<Row>[] => [
  { header: first, get: (r) => r.label },
  { header: 'Primary sales', get: (r) => val(r, 'primary_sales_value'), format: inr },
  { header: 'Primary target', get: (r) => salesTarget(r, 'primary'), format: inr },
  { header: 'Primary ach.', get: (r) => val(r, 'primary_achievement_pct'), format: pct },
  { header: 'Secondary sales', get: (r) => val(r, 'secondary_sales_value'), format: inr },
  { header: 'Secondary target', get: (r) => salesTarget(r, 'secondary'), format: inr },
  { header: 'Secondary ach.', get: (r) => val(r, 'secondary_achievement_pct'), format: pct },
  { header: 'Growth vs LY', get: (r) => val(r, 'growth_vs_ly_pct'), format: pct },
];
