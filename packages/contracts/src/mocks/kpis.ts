import {
  calendarWorkingDates,
  KPI_KEYS,
  KpiQuery,
  KpiReport,
  type KpiKey,
  ProductKpiReport,
} from '../schemas/kpis';
import * as fx from './fixtures';

type Unit = 'count' | 'ratio' | 'percent' | 'inr';
const UNITS: Record<KpiKey, Unit> = Object.fromEntries(
  KPI_KEYS.map((k) => [
    k,
    k.endsWith('_pct')
      ? 'percent'
      : k.endsWith('_value')
        ? 'inr'
        : k.includes('average') || k.includes('per_day')
          ? 'ratio'
          : 'count',
  ]),
) as Record<KpiKey, Unit>;

/** Deterministic fake numerator/denominator per (kpi, seed). */
function metric(kpi: KpiKey, seed: number) {
  const unit = UNITS[kpi];
  const h = [...`${kpi}${seed}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
  if (unit === 'count' || unit === 'inr') {
    const v = unit === 'inr' ? 50000 + (h % 50) * 10000 : 40 + (h % 120);
    return { kpi, value: v, numerator: v, denominator: null, unit, target: null };
  }
  const denominator = unit === 'ratio' ? 18 + (h % 6) : 100 + (h % 80);
  const numerator =
    unit === 'ratio'
      ? denominator * (8 + (h % 6))
      : Math.round(denominator * (0.6 + (h % 40) / 100));
  const value =
    Math.round(
      (unit === 'ratio' ? numerator / denominator : (100 * numerator) / denominator) * 10,
    ) / 10;
  return {
    kpi,
    value,
    numerator,
    denominator,
    unit,
    target: kpi.includes('achievement') ? 100 : null,
  };
}

function period(q: { month?: string; from?: string; to?: string }) {
  const m = q.month ?? new Date().toISOString().slice(0, 7);
  if (q.from || q.to) return { from: q.from ?? `${m}-01`, to: q.to ?? q.from ?? `${m}-28` };
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
}

const TEAM = [
  { userId: '01930000-0000-7000-8000-000000000309', label: 'Demo Business Manager' },
  { userId: '01930000-0000-7000-8000-000000000310', label: 'Demo Business Manager 2' },
];

export function kpiReport(url: URL): KpiReport | { error: string } {
  const parsed = KpiQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid query' };
  const q = parsed.data;
  const keys = q.kpis?.length ? q.kpis : [...KPI_KEYS];
  const rowsFor = (): { userId: string | null; territoryId: string | null; label: string }[] => {
    switch (q.rollup) {
      case 'self':
        return [{ userId: q.userId ?? fx.me.id, territoryId: null, label: fx.me.name }];
      case 'byUser':
        return TEAM.map((t) => ({ ...t, territoryId: null }));
      case 'byTerritory':
        return fx.territories
          .filter((t) => !q.territoryId || t.id === q.territoryId || t.parentId === q.territoryId)
          .map((t) => ({ userId: null, territoryId: t.id, label: t.name }));
      case 'team':
        return [{ userId: fx.me.id, territoryId: null, label: `${fx.me.name} (team)` }];
      case 'company':
        return [{ userId: null, territoryId: null, label: fx.me.companyName }];
    }
  };
  const per = period(q);
  const today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const wd = calendarWorkingDates(per.from, per.to < today ? per.to : today).length;
  return KpiReport.parse({
    ...per,
    rollup: q.rollup,
    generatedAt: new Date().toISOString(),
    rows: rowsFor().map((r, i) => ({
      ...r,
      workingDays: wd,
      metrics: keys.map((k) => metric(k, i)),
    })),
  });
}

export function productKpiReport(url: URL): ProductKpiReport | { error: string } {
  const parsed = KpiQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid query' };
  const q = parsed.data;
  const rows = fx.products
    .filter(
      (p) =>
        (!q.productId || p.id === q.productId) && (!q.divisionId || p.divisionId === q.divisionId),
    )
    .map((p, i) => ({
      productId: p.id,
      productName: p.name,
      detailedCalls: 120 - i * 15,
      firstPositionCalls: 60 - i * 8,
      detailingSharePct: Math.round(((120 - i * 15) / 300) * 1000) / 10,
      sampleQty: 200 - i * 20,
      pobQty: 40 - i * 4,
      pobValue: 25000 - i * 2500,
    }));
  return ProductKpiReport.parse({ ...period(q), rows });
}
