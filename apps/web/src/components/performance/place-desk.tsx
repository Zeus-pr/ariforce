'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { KpiReport, Territory, TerritoryLevel } from '@ariforce/contracts';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@ariforce/ui/components/button';
import { Combobox } from '@ariforce/ui/components/combobox';
import { Input } from '@ariforce/ui/components/input';
import { cn } from '@ariforce/ui/lib/utils';
import { exportXlsx, type ExportCell, type ExportCol } from '@/components/export/export';
import { api, apiReady, toApiError } from '@/lib/api';
import { addMonths, monthLabel } from '@/lib/period';
import { getTerritories } from '@/lib/query';
import { LiquidColumns, SalesTrendChart, YearCompareChart, type LiquidItem } from './sales-charts';
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

type Span = 'month' | 'quarter' | 'fy' | 'custom';

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
  const a = customFrom || month;
  const b = customTo || month;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

function monthsOf(from: string, to: string) {
  const out: string[] = [];
  let cur = from;
  while (cur <= to && out.length < 24) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

function periodTitle(span: Span, month: string) {
  if (span === 'month') return monthLabel(month);
  const m = Number(month.slice(5, 7));
  const y = Number(month.slice(0, 4));
  if (span === 'quarter') return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  if (span === 'fy') return `FY ${m >= 4 ? y : y - 1}`;
  return monthLabel(month);
}

function ChartBox({
  title,
  fileName,
  items,
  children,
}: {
  title: string;
  fileName: string;
  items: LiquidItem[];
  children: ReactNode;
}) {
  const columns: ExportCol[] = [
    { header: 'Name', width: 28 },
    { header: 'Primary', width: 16, align: 'right' },
    { header: 'Primary target', width: 16, align: 'right' },
    { header: 'Secondary', width: 16, align: 'right' },
    { header: 'Secondary target', width: 18, align: 'right' },
  ];
  const rows: ExportCell[][] = items.map((item) => [
    item.name,
    item.primary,
    item.primaryTarget,
    item.secondary,
    item.secondaryTarget,
  ]);
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!rows.length}
          onClick={() =>
            void exportXlsx({
              title,
              meta: [
                'Primary is purchase value. Secondary is secondary minus FRS. The tank fills to the target.',
              ],
              fileName,
              columns,
              rows,
            })
          }
        >
          Download
        </Button>
      </div>
      {children}
    </section>
  );
}

type HqBar = LiquidItem & { opens: boolean };

function sumHq(lists: Row[][], byId: Map<string, Place>): HqBar[] {
  const map = new Map<string, HqBar>();
  for (const list of lists) {
    for (const row of list) {
      if (!row.territoryId) continue;
      const place = byId.get(row.territoryId);
      const cur = map.get(row.territoryId) ?? {
        id: row.territoryId,
        name: place?.name ?? row.label,
        primary: 0,
        secondary: 0,
        primaryTarget: 0,
        secondaryTarget: 0,
        opens: place ? place.level !== 'territory' : false,
      };
      cur.primary += money(row, 'primary_sales_value');
      cur.secondary += money(row, 'secondary_sales_value');
      cur.primaryTarget += targetOf(row, 'primary_sales_value') ?? 0;
      cur.secondaryTarget += targetOf(row, 'secondary_sales_value') ?? 0;
      map.set(row.territoryId, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.primary + b.secondary - (a.primary + a.secondary));
}

type SalesProduct = {
  productId: string;
  name: string;
  brand: string;
  primaryValue: number;
  secondaryValue: number;
};
type SalesPerson = {
  userId: string;
  name: string;
  headquarters: string[];
  products: SalesProduct[];
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

export function PlaceDesk({ title, headerExtra }: { title: string; headerExtra?: ReactNode }) {
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
  const [priorTrend, setPriorTrend] = useState<
    { name: string; month: string; primary: number; secondary: number; target: number }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [span, setSpan] = useState<Span>('month');
  const [personId, setPersonId] = useState('');
  const [brandTargets, setBrandTargets] = useState<
    { name: string; primary: number; secondary: number }[]
  >([]);
  const [hqBars, setHqBars] = useState<HqBar[]>([]);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [salesProducts, setSalesProducts] = useState<SalesProduct[] | null>(null);
  const [salesPeople, setSalesPeople] = useState<SalesPerson[]>([]);
  const [productError, setProductError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const jumped = useRef(false);

  useEffect(() => {
    let live = true;
    void getTerritories()
      .then((list) => {
        if (!live) return;
        const livePlaces = list.filter((p) => !p.deletedAt);
        setPlaces(livePlaces);
        const ids = new Set(livePlaces.map((p) => p.id));
        const tops = livePlaces.filter((p) => !p.parentId || !ids.has(p.parentId));
        const root = tops.length === 1 ? tops[0] : livePlaces.find((p) => !p.parentId);
        const children = root ? livePlaces.filter((p) => p.parentId === root.id) : [];
        const start = children.length === 1 ? children[0] : root;
        setFocusId((cur) => cur ?? start?.id ?? null);
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
  const period = month ? spanOf(span, month, customFrom, customTo) : null;

  useEffect(() => {
    if (!month || !focus || !period) return;
    let live = true;
    setBusy(true);
    setError(null);
    const level = grain(focus.level);
    const months = monthsOf(period.from, period.to);
    const prior = months.map((item) => addMonths(item, -12));
    const all = [...new Set([...months, ...prior])];
    void (async () => {
      const packs = await Promise.all(all.map((item) => placesOf(item, focus.id, level)));
      if (!live) return;
      const byMonth = new Map(all.map((item, i) => [item, packs[i] ?? []]));
      setRows(byMonth.get(months.at(-1) ?? month) ?? []);
      setHqBars(
        sumHq(
          months.map((item) => byMonth.get(item) ?? []),
          byId,
        ),
      );
      setTrend(
        months.map((item) => {
          const total = fig(byMonth.get(item) ?? []);
          return {
            month: item,
            name: monthLabel(item).slice(0, 3),
            primary: total.primary,
            secondary: total.secondary,
            target: total.target,
          };
        }),
      );
      setPriorTrend(
        prior.map((item) => {
          const total = fig(byMonth.get(item) ?? []);
          return {
            month: item,
            name: monthLabel(item).slice(0, 3),
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
  }, [month, focus, period?.from, period?.to, byId]);

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

  const now = fig(rows ?? []);
  const sumTrend = (points: { primary: number; secondary: number }[]) =>
    points.reduce(
      (sum, point) => ({
        primary: sum.primary + point.primary,
        secondary: sum.secondary + point.secondary,
      }),
      { primary: 0, secondary: 0 },
    );
  const years = month
    ? [
        { year: periodTitle(span, addMonths(month, -12)), ...sumTrend(priorTrend) },
        { year: periodTitle(span, month), ...sumTrend(trend) },
      ]
    : [];
  const brandBars = useMemo(() => {
    const totals = new Map<string, LiquidItem>();
    for (const product of salesProducts ?? []) {
      const key = product.brand.toLowerCase();
      const cur = totals.get(key) ?? {
        id: key,
        name: product.brand,
        primary: 0,
        secondary: 0,
        primaryTarget: 0,
        secondaryTarget: 0,
      };
      cur.primary += product.primaryValue;
      cur.secondary += product.secondaryValue;
      totals.set(key, cur);
    }
    for (const target of brandTargets) {
      const key = target.name.toLowerCase();
      const cur = totals.get(key) ?? {
        id: key,
        name: target.name,
        primary: 0,
        secondary: 0,
        primaryTarget: 0,
        secondaryTarget: 0,
      };
      cur.primaryTarget += target.primary;
      cur.secondaryTarget += target.secondary;
      totals.set(key, cur);
    }
    return [...totals.values()]
      .filter(
        (item) => item.primary || item.secondary || item.primaryTarget || item.secondaryTarget,
      )
      .sort((a, b) => b.primary + b.secondary - (a.primary + a.secondary));
  }, [salesProducts, brandTargets]);
  useEffect(() => {
    if (jumped.current || params.get('m') || !focus || !month) return;
    let live = true;
    const look = Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11));
    void Promise.all(look.map((item) => placesOf(item, focus.id, grain(focus.level))))
      .then((packs) => {
        if (!live || jumped.current) return;
        jumped.current = true;
        for (let i = look.length - 1; i >= 0; i--) {
          const total = fig(packs[i] ?? []);
          if ((total.primary || total.secondary) && look[i] !== month) {
            pickMonth(look[i]!);
            return;
          }
        }
      })
      .catch(() => {
        jumped.current = true;
      });
    return () => {
      live = false;
    };
  }, [focus, month, params]);

  useEffect(() => {
    if (!period || !focus) return;
    let live = true;
    setSalesProducts(null);
    setSalesPeople([]);
    setProductError(null);
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
        setProductError(toApiError(r).message);
        setSalesProducts([]);
        setSalesPeople([]);
        setBrandTargets([]);
        return;
      }
      setSalesProducts(r.data?.products ?? []);
      setSalesPeople(r.data?.people ?? []);
      setBrandTargets(r.data?.brandTargets ?? []);
      setPersonId('');
    })().catch((e) => {
      if (!live) return;
      setProductError(e instanceof Error ? e.message : 'Could not load product sales.');
      setSalesProducts([]);
      setSalesPeople([]);
      setBrandTargets([]);
    });
    return () => {
      live = false;
    };
  }, [period?.from, period?.to, focus]);

  function open(id: string, direction: 'forward' | 'back') {
    turn(direction, () => setFocusId(id));
  }

  if (!month || !places)
    return <div className="h-96 animate-pulse rounded-lg bg-muted/40" aria-busy="true" />;

  const placeChoices = places
    .filter(
      (place) =>
        place.level === 'region' ||
        place.level === 'area' ||
        place.level === 'headquarter' ||
        place.id === focus?.id,
    )
    .map((place) => ({
      value: place.id,
      label: place.name,
      group:
        place.level === 'region'
          ? 'RBM'
          : place.level === 'area'
            ? 'ABM'
            : place.level === 'headquarter'
              ? 'BM'
              : LEVEL[place.level],
      hint: place.parentId ? byId.get(place.parentId)?.name : null,
    }));
  const chosen = salesPeople.find((person) => person.userId === personId);
  const productPrimary = (salesProducts ?? []).reduce(
    (sum, product) => sum + product.primaryValue,
    0,
  );
  const productSecondary = (salesProducts ?? []).reduce(
    (sum, product) => sum + product.secondaryValue,
    0,
  );
  const hqPrimaryTarget = hqBars.reduce((sum, place) => sum + place.primaryTarget, 0);
  const hqSecondaryTarget = hqBars.reduce((sum, place) => sum + place.secondaryTarget, 0);
  const allProducts: LiquidItem[] = salesProducts?.length
    ? [
        {
          id: 'all',
          name: focus?.name ?? 'All',
          primary: productPrimary,
          secondary: productSecondary,
          primaryTarget: hqPrimaryTarget,
          secondaryTarget: hqSecondaryTarget,
        },
      ]
    : [];
  const skuItems: LiquidItem[] = (salesProducts ?? []).map((product) => ({
    id: product.productId,
    name: product.name,
    primary: product.primaryValue,
    secondary: product.secondaryValue,
    primaryTarget: 0,
    secondaryTarget: 0,
  }));

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
          {focus && (
            <p className="mt-1 text-sm text-muted-foreground">
              {LEVEL[focus.level]} · primary in, secondary out
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerExtra}
          <MonthSwitch month={month} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Combobox
          aria-label="Place"
          className="w-72"
          placeholder="Search RBM, ABM or BM"
          searchPlaceholder="Search a place"
          options={placeChoices}
          value={focus ? [focus.id] : []}
          onValueChange={(ids) => {
            const next = ids.at(-1);
            if (next) open(next, 'forward');
          }}
        />
        <div
          className="inline-flex rounded-full bg-foreground p-1"
          role="group"
          aria-label="Period"
        >
          {(
            [
              ['month', 'Month'],
              ['quarter', 'Quarter'],
              ['fy', 'Financial year'],
              ['custom', 'Custom'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={span === id}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-medium',
                span === id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-background hover:bg-background/15',
              )}
              onClick={() => setSpan(id)}
            >
              {label}
            </button>
          ))}
        </div>
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
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {busy ? (
        <div className="h-60 animate-pulse rounded-md bg-muted/40" aria-busy="true" />
      ) : trend.some((point) => point.primary || point.secondary || point.target) ||
        hqBars.length > 0 ? (
        <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
          <ChartBox
            title={periodTitle(span, month)}
            fileName={`sales-period-${period?.from ?? month}`}
            items={trend.map((point) => ({
              id: point.month,
              name: point.name,
              primary: point.primary,
              secondary: point.secondary,
              primaryTarget: point.target,
              secondaryTarget: 0,
            }))}
          >
            <SalesTrendChart trend={trend} onMonth={pickMonth} />
          </ChartBox>
          <ChartBox
            title={`${periodTitle(span, addMonths(month, -12))} and ${periodTitle(span, month)}`}
            fileName={`sales-compare-${month}`}
            items={years.map((year) => ({
              id: year.year,
              name: year.year,
              primary: year.primary,
              secondary: year.secondary,
              primaryTarget: 0,
              secondaryTarget: 0,
            }))}
          >
            <YearCompareChart years={years} label="This period and last year" />
          </ChartBox>
        </div>
      ) : (
        !error && (
          <p className="py-8 text-sm text-muted-foreground">
            Nothing filed under {focus?.name ?? 'this place'} in {periodTitle(span, month)}.
          </p>
        )
      )}
      <p className="sr-only">
        {monthLabel(month)} primary {inr(now.primary)}, secondary {inr(now.secondary)}.
      </p>
      {hqBars.length > 0 && (
        <ChartBox
          title="HQ wise target vs primary and secondary"
          fileName={`sales-hq-${period?.from ?? month}`}
          items={hqBars}
        >
          <LiquidColumns
            items={hqBars}
            onOpen={(id) => {
              const place = hqBars.find((item) => item.id === id);
              if (place?.opens) open(id, 'forward');
            }}
          />
        </ChartBox>
      )}
      {productError && (
        <p role="alert" className="text-sm text-destructive">
          {productError}
        </p>
      )}
      {salesProducts === null ? (
        <div className="h-48 animate-pulse rounded-md bg-muted/40" aria-busy="true" />
      ) : (
        salesProducts.length > 0 && (
          <>
            <ChartBox
              title="All product target vs primary and secondary"
              fileName={`sales-all-${period?.from ?? month}`}
              items={allProducts}
            >
              <LiquidColumns items={allProducts} />
            </ChartBox>
            {brandBars.length > 0 && (
              <ChartBox
                title="Brandwise target vs primary and secondary"
                fileName={`sales-brand-${period?.from ?? month}`}
                items={brandBars}
              >
                <LiquidColumns items={brandBars} />
              </ChartBox>
            )}
            <ChartBox
              title="SKU target vs primary and secondary"
              fileName={`sales-sku-${period?.from ?? month}`}
              items={skuItems}
            >
              <LiquidColumns items={skuItems} />
            </ChartBox>
          </>
        )
      )}
      {salesPeople.length > 0 && (
        <section className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs">
          <h2 className="text-base font-semibold">People</h2>
          <Combobox
            aria-label="Person"
            className="w-72"
            placeholder="Search a person"
            searchPlaceholder="Search a name"
            options={salesPeople.map((person) => ({
              value: person.userId,
              label: person.name,
              hint: person.headquarters.join(', '),
            }))}
            value={personId ? [personId] : []}
            onValueChange={(ids) => setPersonId(ids.at(-1) ?? '')}
          />
          {chosen && (
            <ChartBox
              title={`${chosen.name} target vs primary and secondary`}
              fileName={`sales-${chosen.name.toLowerCase().replace(/\s+/g, '-')}`}
              items={chosen.products.map((product) => ({
                id: product.productId,
                name: product.name,
                primary: product.primaryValue,
                secondary: product.secondaryValue,
                primaryTarget: 0,
                secondaryTarget: 0,
              }))}
            >
              <p className="text-sm text-muted-foreground">{chosen.headquarters.join(' · ')}</p>
              <LiquidColumns
                items={chosen.products.map((product) => ({
                  id: product.productId,
                  name: product.name,
                  primary: product.primaryValue,
                  secondary: product.secondaryValue,
                  primaryTarget: 0,
                  secondaryTarget: 0,
                }))}
              />
            </ChartBox>
          )}
        </section>
      )}
    </div>
  );
}
