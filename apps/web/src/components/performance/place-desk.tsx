'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KpiReport, Territory, TerritoryLevel } from '@ariforce/contracts';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@ariforce/ui/components/button';
import { api, apiReady, toApiError } from '@/lib/api';
import { addMonths, monthLabel } from '@/lib/period';
import { getTerritories } from '@/lib/query';
import { SalesTrendChart } from './sales-charts';
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

  const max = Math.max(
    1,
    ...(rows ?? []).map((r) =>
      Math.max(money(r, 'primary_sales_value'), money(r, 'secondary_sales_value')),
    ),
  );
  const now = fig(rows ?? []);

  useEffect(() => {
    if (jumped.current || params.get('m') || !trend.length || !month) return;
    const hit = [...trend].reverse().find((point) => point.primary || point.secondary);
    if (!hit || hit.month === month) return;
    jumped.current = true;
    pickMonth(hit.month);
  }, [trend, month, params]);

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
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <section aria-label="Twelve months" style={{ viewTransitionName: 'place-chart' }}>
        <SalesTrendChart trend={trend} onMonth={pickMonth} />
        <p className="mt-2 text-sm text-muted-foreground tabular-nums">
          {monthLabel(month)} · primary {inr(now.primary)} · secondary {inr(now.secondary)}
          {now.target > 0 ? ` · target ${inr(now.target)}` : ''}
        </p>
      </section>
      <div
        tabIndex={0}
        role="region"
        aria-label="Places under this one"
        aria-busy={busy}
        className="overflow-x-auto overflow-y-clip"
        style={{ viewTransitionName: 'place-list' }}
      >
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="sr-only" id="place-list-caption">
            Places under {focus?.name ?? title}
          </caption>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Place</th>
              <th className="font-medium">Primary</th>
              <th className="font-medium">Secondary</th>
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 && !busy && (
              <tr>
                <td colSpan={3} className="py-8 text-muted-foreground">
                  Nothing filed under {focus?.name ?? 'this place'} in {monthLabel(month)}.
                </td>
              </tr>
            )}
            {grouped.flatMap(([trail, items]) => [
              trail ? (
                <tr key={`trail-${trail}`}>
                  <th
                    colSpan={3}
                    className="pt-4 pb-1 text-left text-xs font-medium text-muted-foreground"
                  >
                    {trail}
                  </th>
                </tr>
              ) : null,
              ...items.map(({ place, row }) => {
                const primary = money(row, 'primary_sales_value');
                const secondary = money(row, 'secondary_sales_value');
                const opens = place.level !== 'territory';
                return (
                  <tr key={place.id} className="border-t">
                    <th className="py-3 pr-3 text-left font-medium">
                      <span>{place.name}</span>
                      <span className="ml-2 font-normal text-muted-foreground">
                        {LEVEL[place.level]}
                      </span>
                      {opens && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="ml-3"
                          onClick={() => open(place.id, 'forward')}
                        >
                          Open
                        </Button>
                      )}
                    </th>
                    <td className="py-3 tabular-nums">
                      <Bar amount={primary} max={max} color="var(--color-chart-1)" />
                      {inr(primary)}
                    </td>
                    <td className="py-3 tabular-nums">
                      <Bar amount={secondary} max={max} color="var(--color-chart-2)" />
                      {inr(secondary)}
                    </td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Bar({ amount, max, color }: { amount: number; max: number; color: string }) {
  return (
    <span className="mb-1 block h-1.5 w-full max-w-40 rounded-full bg-muted">
      <span
        className="place-bar block h-full rounded-full"
        style={{
          width: `${Math.max(0, Math.min(100, (amount / max) * 100))}%`,
          background: color,
        }}
      />
    </span>
  );
}
