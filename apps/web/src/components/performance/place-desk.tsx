'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KpiReport, Territory, TerritoryLevel } from '@ariforce/contracts';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { exportXlsx } from '@/components/export/export';
import { api, apiReady, toApiError } from '@/lib/api';
import { addMonths, monthLabel } from '@/lib/period';
import { getTerritories } from '@/lib/query';
import { PlaceCompareChart, SalesTrendChart, YearCompareChart } from './sales-charts';
import { MonthSwitch, inr, useMonth } from './perf-ui';

const KPIS =
  'primary_sales_value,primary_achievement_pct,secondary_sales_value,secondary_achievement_pct';

const LEVEL: Record<TerritoryLevel, string> = {
  national: 'Country',
  zone: 'State',
  region: 'Region',
  area: 'Area',
  headquarter: 'Headquarters',
  territory: 'Territory',
};

type Row = KpiReport['rows'][number];
type Place = Territory;
type Fig = { primary: number; secondary: number; target: number };

function money(row: Row | undefined, kpi: string) {
  return row?.metrics.find((m) => m.kpi === kpi)?.value ?? 0;
}
function targetOf(row: Row | undefined, kpi: string) {
  return row?.metrics.find((m) => m.kpi === kpi)?.target ?? null;
}
function fig(rows: Row[]): Fig {
  return {
    primary: rows.reduce((s, r) => s + money(r, 'primary_sales_value'), 0),
    secondary: rows.reduce((s, r) => s + money(r, 'secondary_sales_value'), 0),
    target: rows.reduce((s, r) => s + (targetOf(r, 'primary_sales_value') ?? 0), 0),
  };
}

function grain(level: TerritoryLevel): TerritoryLevel {
  return level === 'headquarter' || level === 'territory' ? 'territory' : 'headquarter';
}

type Span = 'month' | 'quarter' | 'fy' | 'last12' | 'custom';

function spanOf(mode: Span, month: string, customFrom: string, customTo: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  if (mode === 'month') return { from: month, to: month };
  if (mode === 'quarter') {
    const startM = Math.floor((m - 1) / 3) * 3 + 1;
    const start = `${y}-${String(startM).padStart(2, '0')}`;
    const end = `${y}-${String(startM + 2).padStart(2, '0')}`;
    return { from: start, to: month < end ? month : end };
  }
  if (mode === 'fy') {
    const startYear = m >= 4 ? y : y - 1;
    const start = `${startYear}-04`;
    const end = `${startYear + 1}-03`;
    return { from: start, to: month < end ? month : end };
  }
  if (mode === 'last12') return { from: addMonths(month, -11), to: month };
  const a = customFrom || month;
  const b = customTo || month;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

type SalesLine = {
  month: string;
  headquarters: string;
  stockist: string;
  product: string;
  primaryQty: number;
  primaryValue: number;
  secondaryQty: number;
  secondaryValue: number;
  closingQty: number;
};
type SalesProduct = {
  productId: string;
  name: string;
  primaryValue: number;
  secondaryValue: number;
};

async function placesOf(month: string, territoryId: string, territoryLevel?: TerritoryLevel) {
  await apiReady();
  const r = await api.GET('/v1/kpis', {
    params: {
      query: {
        month,
        rollup: 'byTerritory',
        territoryId,
        kpis: KPIS,
        ...(territoryLevel ? { territoryLevel } : {}),
      } as never,
    },
  });
  if (r.error) throw new Error(toApiError(r).message);
  return r.data?.rows ?? [];
}

function turn(direction: 'forward' | 'back', update: () => void) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = document.startViewTransition?.bind(document) as
    ((arg: { update: () => void; types: string[] } | (() => void)) => void) | undefined;
  if (reduced || !start) {
    update();
    return;
  }
  start({ update, types: [direction] });
}

export function PlaceDesk({ title }: { title: string }) {
  const month = useMonth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pickMonth = (m: string) => {
    const s = new URLSearchParams(params.toString());
    s.set('m', m);
    router.push(`${pathname}?${s}`, { scroll: false });
  };
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [trend, setTrend] = useState<
    { name: string; month: string; primary: number; secondary: number; target: number }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [span, setSpan] = useState<Span>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [salesProducts, setSalesProducts] = useState<SalesProduct[]>([]);
  const [salesLines, setSalesLines] = useState<SalesLine[]>([]);
  const [busy, setBusy] = useState(true);
  const jumped = useRef(false);

  useEffect(() => {
    let live = true;
    void getTerritories()
      .then((list) => {
        if (!live) return;
        const livePlaces = list.filter((p) => !p.deletedAt);
        setPlaces(livePlaces);
        const root = livePlaces.find((p) => !p.parentId);
        const zones = livePlaces.filter((p) => p.parentId === root?.id);
        setFocusId((cur) => cur ?? (zones.length === 1 ? zones[0]!.id : (root?.id ?? null)));
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : 'Could not load places.');
      });
    return () => {
      live = false;
    };
  }, []);

  const byId = useMemo(() => new Map((places ?? []).map((p) => [p.id, p])), [places]);
  const focus = focusId ? byId.get(focusId) : undefined;

  useEffect(() => {
    if (!month || !focus) return;
    let live = true;
    setBusy(true);
    setError(null);
    const level = grain(focus.level);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11));
    void (async () => {
      const packs = await Promise.all(months.map((m) => placesOf(m, focus.id, level)));
      if (!live) return;
      const current = packs[packs.length - 1] ?? [];
      setRows(current);
      setTrend(
        months.map((m, i) => {
          const total = fig(packs[i] ?? []);
          return {
            month: m,
            name: monthLabel(m).slice(0, 3),
            primary: total.primary,
            secondary: total.secondary,
            target: total.target,
          };
        }),
      );
      setBusy(false);
    })().catch((e) => {
      if (!live) return;
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not load sales.');
    });
    return () => {
      live = false;
    };
  }, [month, focus]);

  const path = useMemo(() => {
    const chain: Place[] = [];
    let cur = focus;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return chain;
  }, [focus, byId]);

  const grouped = useMemo(() => {
    const groups = new Map<string, { place: Place; row: Row; trail: string }[]>();
    for (const row of rows ?? []) {
      const place = row.territoryId ? byId.get(row.territoryId) : undefined;
      if (!place || !focus) continue;
      const names: string[] = [];
      let cur = place.parentId ? byId.get(place.parentId) : undefined;
      const seen = new Set<string>();
      while (cur && cur.id !== focus.id && !seen.has(cur.id)) {
        seen.add(cur.id);
        names.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      const trail = [...new Set(names)].join(' · ');
      groups.set(trail, [...(groups.get(trail) ?? []), { place, row, trail }]);
    }
    return [...groups.entries()];
  }, [rows, byId, focus]);

  const now = fig(rows ?? []);
  const years = useMemo(() => {
    const byYear = new Map<string, { primary: number; secondary: number }>();
    for (const point of trend) {
      const year = point.month.slice(0, 4);
      const cur = byYear.get(year) ?? { primary: 0, secondary: 0 };
      byYear.set(year, {
        primary: cur.primary + point.primary,
        secondary: cur.secondary + point.secondary,
      });
    }
    return [...byYear.entries()].map(([year, value]) => ({ year, ...value }));
  }, [trend]);
  const placeBars = useMemo(
    () =>
      grouped.flatMap(([, items]) =>
        items.map(({ place, row }) => ({
          id: place.id,
          name: place.name,
          primary: money(row, 'primary_sales_value'),
          secondary: money(row, 'secondary_sales_value'),
          opens: place.level !== 'territory',
        })),
      ),
    [grouped],
  );

  useEffect(() => {
    if (jumped.current || params.get('m') || !trend.length || !month) return;
    const hit = [...trend].reverse().find((point) => point.primary || point.secondary);
    if (!hit || hit.month === month) return;
    jumped.current = true;
    pickMonth(hit.month);
  }, [trend, month, params]);

  const period = month ? spanOf(span, month, customFrom, customTo) : null;

  useEffect(() => {
    if (!period || !focus) return;
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/stock-statements/sales', {
        params: {
          query: {
            from: period.from,
            to: period.to,
            ...(focus.level === 'national' ? {} : { territoryId: focus.id }),
          },
        },
      });
      if (!live) return;
      if (r.error) {
        setError(toApiError(r).message);
        return;
      }
      setSalesProducts(r.data?.products ?? []);
      setSalesLines(r.data?.lines ?? []);
    })().catch((e) => {
      if (live) setError(e instanceof Error ? e.message : 'Could not load product sales.');
    });
    return () => {
      live = false;
    };
  }, [period?.from, period?.to, focus]);

  function open(id: string, direction: 'forward' | 'back') {
    turn(direction, () => setFocusId(id));
  }

  if (!month) return <div className="h-96" aria-busy="true" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Place" className="flex flex-wrap items-center gap-1">
            {path.map((place, i) => (
              <span key={place.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground">/</span>}
                <Button
                  type="button"
                  variant={place.id === focus?.id ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => open(place.id, 'back')}
                >
                  {place.name}
                </Button>
              </span>
            ))}
          </nav>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance">
            {focus?.name ?? title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {LEVEL[focus?.level ?? 'national']} · primary in, secondary out
          </p>
        </div>
        <MonthSwitch month={month} />
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
        {(
          [
            ['month', 'Month'],
            ['quarter', 'Quarter'],
            ['fy', 'Financial year'],
            ['last12', 'Last 12 months'],
            ['custom', 'Custom'],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={span === id ? 'secondary' : 'outline'}
            aria-pressed={span === id}
            onClick={() => setSpan(id)}
          >
            {label}
          </Button>
        ))}
        {span === 'custom' && (
          <>
            <Input
              type="month"
              aria-label="From"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <Input
              type="month"
              aria-label="To"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!salesLines.length}
          onClick={() =>
            void exportXlsx({
              title: `Sales ${focus?.name ?? title}`,
              meta: [
                `${period?.from ?? ''} to ${period?.to ?? ''}`,
                'Primary is the purchase value on approved stock sheets. Secondary is secondary minus FRS.',
              ],
              fileName: `sales-${period?.from ?? 'from'}-${period?.to ?? 'to'}`,
              columns: [
                { header: 'Month', width: 12 },
                { header: 'Headquarters', width: 22 },
                { header: 'Stockist', width: 28 },
                { header: 'Product', width: 28 },
                { header: 'Primary qty', width: 14, align: 'right' },
                { header: 'Primary value', width: 16, align: 'right' },
                { header: 'Secondary qty', width: 14, align: 'right' },
                { header: 'Secondary value', width: 16, align: 'right' },
                { header: 'Closing qty', width: 14, align: 'right' },
              ],
              rows: salesLines.map((line) => [
                line.month,
                line.headquarters,
                line.stockist,
                line.product,
                line.primaryQty,
                line.primaryValue,
                line.secondaryQty,
                line.secondaryValue,
                line.closingQty,
              ]),
            })
          }
        >
          Download
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <section
        aria-label="Twelve months"
        className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]"
        style={{ viewTransitionName: 'place-chart' }}
      >
        <SalesTrendChart trend={trend} onMonth={pickMonth} />
        <YearCompareChart years={years} />
      </section>
      <p className="sr-only">
        {monthLabel(month)} primary {inr(now.primary)}, secondary {inr(now.secondary)}
        {now.target > 0 ? `, target ${inr(now.target)}` : ''}.
      </p>
      <div aria-busy={busy} style={{ viewTransitionName: 'place-list' }}>
        {placeBars.length > 0 ? (
          <PlaceCompareChart
            places={placeBars}
            onOpen={(id) => {
              const place = placeBars.find((p) => p.id === id);
              if (place?.opens) open(id, 'forward');
            }}
          />
        ) : (
          !busy && (
            <p className="py-8 text-sm text-muted-foreground">
              Nothing filed under {focus?.name ?? 'this place'} in {monthLabel(month)}.
            </p>
          )
        )}
      </div>
      <section aria-label="Product sales">
        <h2 className="text-sm font-medium">Products</h2>
        {salesProducts.length > 0 ? (
          <PlaceCompareChart
            places={salesProducts.map((product) => ({
              id: product.productId,
              name: product.name,
              primary: product.primaryValue,
              secondary: product.secondaryValue,
            }))}
          />
        ) : (
          <p className="py-6 text-sm text-muted-foreground">
            No approved stock-sheet sales in this period.
          </p>
        )}
      </section>
    </div>
  );
}
