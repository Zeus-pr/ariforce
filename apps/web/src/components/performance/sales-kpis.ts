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
