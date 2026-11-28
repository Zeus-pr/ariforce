'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { productBrand, type Territory, type TerritoryLevel } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Combobox } from '@ariforce/ui/components/combobox';
import { Input } from '@ariforce/ui/components/input';
import { can } from '@/components/exceptions/model';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady, toApiError } from '@/lib/api';
import { allPages } from '@/lib/paging';
import { productsQuery, useTerritories } from '@/lib/query';
import { inr } from './perf-ui';
import {
  applyMonth,
  applyQuarter,
  applyYear,
  cloneSheet,
  emptyMonths,
  gapPaise,
  idKey,
  parseRupees,
  pointKey,
  readMonths,
  saveOps,
  sheetKey,
  spreadWeights,
  sumPaise,
  withMonths,
  type Kind,
  type Months,
  type SaveOp,
  type Sheet,
} from './target-sheet';

const LABEL: Record<TerritoryLevel, string> = {
  national: 'Country',
  zone: 'State',
  region: 'RBM HQ',
  area: 'ABM HQ',
  headquarter: 'BM HQ',
  territory: 'Territory',
};
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const QUARTERS = [
  { label: 'Q1', range: 'January–March' },
  { label: 'Q2', range: 'April–June' },
  { label: 'Q3', range: 'July–September' },
  { label: 'Q4', range: 'October–December' },
] as const;
const KINDS: Kind[] = ['primary', 'secondary'];

type Person = {
  name: string;
  status?: string | null;
  territoryIds?: string[];
};
type TargetRow = {
  id: string;
  territoryId: string;
  month: string;
  kind: Kind;
  brand: string | null;
  value: number;
};

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
}

function kidsOf(places: readonly Territory[]) {
  const map = new Map<string, Territory[]>();
  for (const place of places) {
    if (!place.parentId || place.level === 'territory') continue;
    const list = map.get(place.parentId) ?? [];
    list.push(place);
    map.set(place.parentId, list);
  }
  for (const list of map.values()) list.sort(byName);
  return map;
}

function hqsUnder(root: Territory, children: Map<string, Territory[]>): Territory[] {
  if (root.level === 'headquarter') return [root];
  const out: Territory[] = [];
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (child.level === 'headquarter') out.push(child);
      else walk(child.id);
    }
  };
  walk(root.id);
  return out.sort(byName);
}

function hitPlace(place: Territory, needle: string, people: readonly Person[]) {
  return (
    place.name.toLowerCase().includes(needle) ||
    place.code.toLowerCase().includes(needle) ||
    namesOn(place.id, people).toLowerCase().includes(needle)
  );
}

function namesOn(id: string, people: readonly Person[]) {
  return people
    .filter((person) => person.territoryIds?.includes(id))
    .sort(
      (a, b) =>
        Number(b.status === 'active') - Number(a.status === 'active') ||
        a.name.localeCompare(b.name),
    )
    .map((person) => person.name)
    .join(', ');
}

function money(paise: number | null) {
  if (paise == null) return '—';
  const sign = paise < 0 ? '−' : '';
  return `${sign}${inr(Math.abs(paise) / 100)}`;
}

function showPaise(paise: number) {
  const rupees = paise / 100;
  if (paise % 100 === 0) return rupees.toLocaleString('en-IN');
  return rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MoneyField({
  label,
  paise,
  faint,
  disabled,
  onCommit,
}: {
  label: string;
  paise: number | null;
  faint: number | null;
  disabled: boolean;
  onCommit: (paise: number | null) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="flex min-w-28 flex-col items-end gap-0.5">
      <span className="sr-only">{label}</span>
      <input
        inputMode="decimal"
        disabled={disabled}
        aria-label={label}
        className="h-8 w-28 rounded-md border bg-white px-2 text-right text-sm tabular-nums"
        value={text ?? (paise == null ? '' : showPaise(paise))}
        onFocus={() => setText(paise == null ? '' : String(paise / 100))}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const parsed = parseRupees(text ?? '');
          setText(null);
          if (parsed === undefined) return;
          if (parsed === paise) return;
          onCommit(parsed);
        }}
      />
      {faint != null && faint > 0 && (
        <span className="text-[10px] text-slate-400 tabular-nums">{inr(faint / 100)}</span>
      )}
    </label>
  );
}

async function runOps(ops: SaveOp[]) {
  let cursor = 0;
  let failure: string | null = null;
  async function worker() {
    while (cursor < ops.length && !failure) {
      const op = ops[cursor++];
      if (!op) return;
      if (op.op === 'delete') {
        const r = await api.DELETE('/v1/sales/targets/{id}', { params: { path: { id: op.id } } });
        if (r.error && toApiError(r).code !== 'NOT_FOUND') {
          failure = toApiError(r).message || 'Could not clear a month.';
        }
        continue;
      }
      const r = await api.PUT('/v1/sales/targets', {
        body: {
          territoryId: op.territoryId,
          kind: op.kind,
          fromMonth: op.month,
          toMonth: op.month,
          value: op.rupees,
          spread: 'each',
          quantity: null,
          brand: op.brand,
          overwrite: true,
        },
      });
      if (r.error) failure = toApiError(r).message || 'Could not save a month.';
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ops.length) }, () => worker()));
  if (failure) throw new Error(failure);
}

export function SetTargetsScreen() {
  const { role } = useRole();
  const allowed = can(role, 'sales:write');
  const terrs = useTerritories();
  const products = useQuery(productsQuery);
  const places = useMemo(
    () => (terrs.data ?? []).filter((place) => !place.deletedAt && place.level !== 'territory'),
    [terrs.data],
  );
  const children = useMemo(() => kidsOf(places), [places]);
  const rootId = places.find((place) => !place.parentId)?.id ?? null;
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'months' | 'brands'>('months');
  const [saved, setSaved] = useState<Sheet>({ cells: {} });
  const [sheet, setSheet] = useState<Sheet>({ cells: {} });
  const [ids, setIds] = useState<Record<string, string>>({});
  const [lastYear, setLastYear] = useState<Record<string, number>>({});
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && rootId) setSelectedId(rootId);
  }, [rootId, selectedId]);

  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await allPages(
        (cursor) => api.GET('/v1/users', { params: { query: { limit: 100, cursor } } }),
        100,
      );
      if (!live || r.error) return;
      setPeople((r.data?.items ?? []) as Person[]);
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    setLoading(true);
    void (async () => {
      await apiReady();
      const listed = await api.GET('/v1/sales/targets', {
        params: { query: { from: `${year - 1}-01`, to: `${year}-12` } },
      });
      if (!live) return;
      if (listed.error || !listed.data) {
        setError(toApiError(listed).message || 'Could not load targets.');
        setLoading(false);
        return;
      }
      const next: Sheet = { cells: {} };
      const nextIds: Record<string, string> = {};
      const prior: Record<string, number> = {};
      for (const row of listed.data.data as TargetRow[]) {
        const [rowYear, month] = row.month.split('-').map(Number) as [number, number];
        const index = month - 1;
        const brand = row.brand ?? '';
        if (index < 0 || index > 11) continue;
        if (rowYear === year) {
          const months = (
            next.cells[sheetKey(row.territoryId, brand, row.kind)] ?? emptyMonths()
          ).slice();
          months[index] = Math.round(row.value * 100);
          next.cells[sheetKey(row.territoryId, brand, row.kind)] = months;
          nextIds[idKey(row.territoryId, brand, row.kind, row.month)] = row.id;
        } else if (rowYear === year - 1) {
          prior[pointKey(row.territoryId, brand, row.kind, index)] = Math.round(row.value * 100);
        }
      }
      const seen: Record<string, number> = {};
      if (rootId) {
        const reports = await Promise.all(
          MONTH_NAMES.map((_, index) =>
            api.GET('/v1/kpis', {
              params: {
                query: {
                  month: `${year - 1}-${String(index + 1).padStart(2, '0')}`,
                  rollup: 'byTerritory',
                  territoryId: rootId,
                  territoryLevel: 'headquarter',
                  kpis: ['primary_sales_value', 'secondary_sales_value'],
                },
              },
            }),
          ),
        );
        reports.forEach((report, index) => {
          for (const row of report.data?.rows ?? []) {
            if (!row.territoryId) continue;
            for (const kind of KINDS) {
              const kpi = kind === 'primary' ? 'primary_sales_value' : 'secondary_sales_value';
              const value = row.metrics.find((metric) => metric.kpi === kpi)?.value;
              if (value == null) continue;
              seen[pointKey(row.territoryId, '', kind, index)] = Math.round(value * 100);
            }
          }
        });
      }
      if (!live) return;
      setSaved(next);
      setSheet(cloneSheet(next));
      setIds(nextIds);
      setLastYear(prior);
      setActuals(seen);
      setError(null);
      setNotice(null);
      setLoading(false);
    })().catch((e) => {
      if (!live) return;
      setError(e instanceof Error ? e.message : 'Could not load targets.');
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [allowed, rootId, tick, year]);

  const brands = useMemo(() => {
    const names = new Map<string, string>();
    for (const product of products.data ?? []) {
      if (product.deletedAt) continue;
      const name = productBrand(product);
      if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [products.data]);
  const brandHints = useMemo(() => {
    const lists = new Map<string, string[]>();
    for (const product of products.data ?? []) {
      if (product.deletedAt) continue;
      const brand = productBrand(product);
      const list = lists.get(brand) ?? [];
      if (!list.includes(product.name)) list.push(product.name);
      lists.set(brand, list);
    }
    return new Map([...lists].map(([brand, list]) => [brand, list.join(', ')]));
  }, [products.data]);

  const selected = places.find((place) => place.id === selectedId) ?? null;
  const needle = query.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!needle) return null;
    const byId = new Map(places.map((place) => [place.id, place]));
    const ids = new Set<string>();
    for (const place of places) {
      if (!hitPlace(place, needle, people)) continue;
      let id: string | null = place.id;
      const seen = new Set<string>();
      while (id && !seen.has(id)) {
        seen.add(id);
        ids.add(id);
        id = byId.get(id)?.parentId ?? null;
      }
    }
    return ids;
  }, [needle, people, places]);
  const hqRows = selected ? hqsUnder(selected, children) : [];
  const visibleHqs =
    !needle || (selected != null && hitPlace(selected, needle, people))
      ? hqRows
      : hqRows.filter((row) => hitPlace(row, needle, people));
  const onHq = selected?.level === 'headquarter';
  const dirty = saveOps(year, saved, sheet, ids).length > 0;

  function faintOf(territoryId: string, brand: string, kind: Kind, index: number) {
    if (!brand) {
      const key = pointKey(territoryId, '', kind, index);
      if (key in actuals) {
        const actual = actuals[key] ?? 0;
        return actual > 0 ? actual : null;
      }
    }
    const prior = lastYear[pointKey(territoryId, brand, kind, index)];
    return prior != null && prior > 0 ? prior : null;
  }

  function weightsFor(territoryId: string, brand: string, kind: Kind, indexes: readonly number[]) {
    const actual = indexes.map((index) =>
      brand ? 0 : (actuals[pointKey(territoryId, '', kind, index)] ?? 0),
    );
    const prior = indexes.map((index) => lastYear[pointKey(territoryId, brand, kind, index)] ?? 0);
    const weights = spreadWeights(actual, prior);
    return weights.length === indexes.length ? weights : indexes.map(() => 1);
  }

  function putLine(
    territoryId: string,
    brand: string,
    kind: Kind,
    produce: (months: Months) => Months,
  ) {
    setSheet((current) =>
      withMonths(
        current,
        territoryId,
        brand,
        kind,
        produce(readMonths(current, territoryId, brand, kind)),
      ),
    );
    setNotice(null);
  }

  function spread() {
    const rows = onHq && tab === 'brands' ? [] : onHq ? [selected!] : hqRows;
    const brandRows =
      onHq && tab === 'brands' ? brandsFor(selected!.id, sheet, lastYear, brands) : [''];
    setSheet((current) => {
      let next = current;
      const targets = onHq && tab === 'brands' ? [selected!] : rows;
      for (const hq of targets) {
        for (const brand of onHq && tab === 'brands' ? brandRows : ['']) {
          for (const kind of KINDS) {
            const months = readMonths(next, hq.id, brand, kind);
            const total = sumPaise(months);
            if (months.some((n) => n == null) || total == null || total <= 0) continue;
            next = withMonths(
              next,
              hq.id,
              brand,
              kind,
              applyYear(
                months,
                total,
                weightsFor(
                  hq.id,
                  brand,
                  kind,
                  MONTH_NAMES.map((_, i) => i),
                ),
              ),
            );
          }
        }
      }
      return next;
    });
    setNotice('A full year follows last year. A month left open stays open.');
  }

  async function save() {
    const ops = saveOps(year, saved, sheet, ids);
    if (!ops.length) return;
    setBusy(true);
    setError(null);
    try {
      await apiReady();
      await runOps(ops);
      setNotice(`Saved ${ops.length} change${ops.length === 1 ? '' : 's'}.`);
      setTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">You can’t set targets.</p>
        <Link href="/sales" className="text-sm font-medium text-[#0C8498]">
          Back to sales
        </Link>
      </div>
    );
  }

  const years = [year - 1, year, year + 1];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="set-targets">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-[#0F2A4A]">Set targets</h1>
          <select
            aria-label="Year"
            className="h-9 rounded-md border bg-white px-2 text-sm"
            value={year}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (dirty) {
                setError('Save this sheet before changing the year.');
                return;
              }
              setYear(next);
            }}
          >
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sales" className="px-2 text-sm font-medium text-[#0C8498]">
            Back to sales
          </Link>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setSheet(cloneSheet(saved));
                setNotice(null);
                setError(null);
              }}
            >
              Discard
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy || loading} onClick={spread}>
            Spread by last year
          </Button>
          <Button type="button" disabled={busy || loading || !dirty} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && !error && <p className="text-sm text-muted-foreground">{notice}</p>}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <section className="min-h-0 overflow-auto rounded-xl border bg-white p-3">
          <h2 className="px-2 pb-2 text-sm font-semibold text-[#0F2A4A]">Places</h2>
          <Input
            aria-label="Find a place"
            placeholder="Find a place, HQ, or person"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mb-2 bg-white"
          />
          {terrs.isPending && <p className="px-2 text-sm text-muted-foreground">Loading places.</p>}
          {needle && matchIds?.size === 0 && (
            <p className="px-2 text-sm text-muted-foreground">No place matches.</p>
          )}
          <ul>
            <PlaceRows
              places={places}
              childrenOf={children}
              parentId={null}
              depth={0}
              openIds={openIds}
              matchIds={matchIds}
              selectedId={selectedId}
              people={people}
              onToggle={(id) =>
                setOpenIds((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onSelect={(id) => {
                setSelectedId(id);
                setTab('months');
                setNotice(null);
              }}
            />
          </ul>
        </section>
        <section className="min-h-0 overflow-auto rounded-xl border bg-white p-4">
          {loading && <p className="text-sm text-muted-foreground">Loading targets.</p>}
          {!loading && selected && !onHq && (
            <HqSheet
              place={selected}
              year={year}
              rows={visibleHqs}
              people={people}
              sheet={sheet}
              disabled={busy}
              faintOf={faintOf}
              onYear={(id, kind, total) =>
                putLine(id, '', kind, (months) =>
                  applyYear(
                    months,
                    total,
                    weightsFor(
                      id,
                      '',
                      kind,
                      MONTH_NAMES.map((_, index) => index),
                    ),
                  ),
                )
              }
            />
          )}
          {!loading && selected && onHq && (
            <MonthSheet
              place={selected}
              person={namesOn(selected.id, people)}
              year={year}
              tab={tab}
              brands={brands}
              brandHints={brandHints}
              query={needle}
              known={brandsFor(selected.id, sheet, lastYear, brands)}
              sheet={sheet}
              disabled={busy}
              faintOf={faintOf}
              onTab={setTab}
              onMonth={(kind, index, total) =>
                putLine(selected.id, '', kind, (months) => applyMonth(months, index, total))
              }
              onQuarter={(kind, quarter, total) =>
                putLine(selected.id, '', kind, (months) =>
                  applyQuarter(
                    months,
                    quarter,
                    total,
                    weightsFor(selected.id, '', kind, [
                      quarter * 3,
                      quarter * 3 + 1,
                      quarter * 3 + 2,
                    ]),
                  ),
                )
              }
              onBrandYear={(brand, kind, total) =>
                putLine(selected.id, brand, kind, (months) =>
                  applyYear(
                    months,
                    total,
                    weightsFor(
                      selected.id,
                      brand,
                      kind,
                      MONTH_NAMES.map((_, index) => index),
                    ),
                  ),
                )
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}

function brandsFor(
  hqId: string,
  sheet: Sheet,
  lastYear: Record<string, number>,
  catalog: readonly string[],
) {
  const found = new Set<string>();
  for (const key of Object.keys(sheet.cells)) {
    const [id, brand] = key.split('\u001f');
    if (id === hqId && brand) found.add(brand);
  }
  for (const key of Object.keys(lastYear)) {
    const [id, brand] = key.split('\u001f');
    if (id === hqId && brand) found.add(brand);
  }
  return [...found].sort((a, b) => a.localeCompare(b) || catalog.indexOf(a) - catalog.indexOf(b));
}

function PlaceRows({
  places,
  childrenOf,
  parentId,
  depth,
  openIds,
  matchIds,
  selectedId,
  people,
  onToggle,
  onSelect,
}: {
  places: Territory[];
  childrenOf: Map<string, Territory[]>;
  parentId: string | null;
  depth: number;
  openIds: Set<string>;
  matchIds: Set<string> | null;
  selectedId: string | null;
  people: Person[];
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const rows = (
    parentId
      ? (childrenOf.get(parentId) ?? [])
      : places.filter((place) => !place.parentId).sort(byName)
  ).filter((place) => !matchIds || matchIds.has(place.id));
  return rows.map((place) => {
    const kids = childrenOf.get(place.id) ?? [];
    const open = matchIds != null || openIds.has(place.id);
    const who = namesOn(place.id, people);
    return (
      <li key={place.id}>
        <div
          className={`flex items-center gap-1 rounded-md pr-2 ${
            selectedId === place.id ? 'bg-[#E8F6F9]' : ''
          }`}
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              aria-label={open ? `Fold ${place.name}` : `Open ${place.name}`}
              className="grid size-6 shrink-0 place-items-center text-slate-500"
              onClick={() => onToggle(place.id)}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
            onClick={() => onSelect(place.id)}
          >
            <span className="truncate text-sm font-medium text-[#0F2A4A]">{place.name}</span>
            {place.level !== 'national' && place.level !== 'zone' && (
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                {LABEL[place.level]}
              </span>
            )}
            {who && <span className="ml-auto truncate text-xs text-slate-500">{who}</span>}
          </button>
        </div>
        {open && (
          <ul>
            <PlaceRows
              places={places}
              childrenOf={childrenOf}
              parentId={place.id}
              depth={depth + 1}
              openIds={openIds}
              matchIds={matchIds}
              selectedId={selectedId}
              people={people}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          </ul>
        )}
      </li>
    );
  });
}

function Foot({
  cells,
}: {
  cells: { label: string; primary: number | null; secondary: number | null; tone?: 'gap' }[];
}) {
  return (
    <div className="mt-4 grid gap-2 border-t pt-3 sm:grid-cols-3">
      {cells.map((cell) => (
        <div key={cell.label}>
          <div className="text-xs text-slate-500">{cell.label}</div>
          <div
            className={`text-sm font-medium tabular-nums ${
              cell.tone === 'gap' ? 'text-[#0C8498]' : 'text-[#0F2A4A]'
            }`}
          >
            {cell.primary == null && cell.secondary == null
              ? '—'
              : `${money(cell.primary)} primary · ${money(cell.secondary)} secondary`}
          </div>
        </div>
      ))}
    </div>
  );
}

function HqSheet({
  place,
  year,
  rows,
  people,
  sheet,
  disabled,
  faintOf,
  onYear,
}: {
  place: Territory;
  year: number;
  rows: Territory[];
  people: Person[];
  sheet: Sheet;
  disabled: boolean;
  faintOf: (territoryId: string, brand: string, kind: Kind, index: number) => number | null;
  onYear: (id: string, kind: Kind, total: number | null) => void;
}) {
  const total = (kind: Kind) =>
    sumPaise(rows.map((row) => sumPaise(readMonths(sheet, row.id, '', kind))));
  const prior = (kind: Kind) =>
    sumPaise(
      rows.map((row) => sumPaise(MONTH_NAMES.map((_, index) => faintOf(row.id, '', kind, index)))),
    );
  return (
    <div>
      <h2 className="text-lg font-semibold text-[#0F2A4A]">
        {place.name}{' '}
        {place.level !== 'national' && place.level !== 'zone' && (
          <span className="rounded-md bg-[#0CAAC1] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-white">
            {LABEL[place.level]}
          </span>
        )}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {namesOn(place.id, people) ? `${namesOn(place.id, people)}. ` : ''}
        Primary and secondary for {year}. Last year is the faint number. Typing a year replaces its
        twelve months.
      </p>
      {rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">No headquarters to show.</p>
      )}
      {rows.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">Headquarters</th>
              <th>Person</th>
              <th className="text-right">Primary</th>
              <th className="text-right">Secondary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="py-2 font-medium text-[#0F2A4A]">{row.name}</td>
                <td className="text-slate-600">{namesOn(row.id, people)}</td>
                {KINDS.map((kind) => {
                  const months = readMonths(sheet, row.id, '', kind);
                  const amount = sumPaise(months);
                  const faint = sumPaise(
                    MONTH_NAMES.map((_, index) => faintOf(row.id, '', kind, index)),
                  );
                  return (
                    <td key={kind} className="py-2">
                      <div className="flex justify-end">
                        <MoneyField
                          label={`${row.name} ${kind} ${year}`}
                          paise={amount}
                          faint={faint}
                          disabled={disabled}
                          onCommit={(total) => onYear(row.id, kind, total)}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Foot
        cells={[
          { label: place.name, primary: total('primary'), secondary: total('secondary') },
          { label: 'Last year', primary: prior('primary'), secondary: prior('secondary') },
        ]}
      />
    </div>
  );
}

function MonthSheet({
  place,
  person,
  year,
  tab,
  brands,
  brandHints,
  query,
  known,
  sheet,
  disabled,
  faintOf,
  onTab,
  onMonth,
  onQuarter,
  onBrandYear,
}: {
  place: Territory;
  person: string;
  year: number;
  tab: 'months' | 'brands';
  brands: string[];
  brandHints: Map<string, string>;
  query: string;
  known: string[];
  sheet: Sheet;
  disabled: boolean;
  faintOf: (territoryId: string, brand: string, kind: Kind, index: number) => number | null;
  onTab: (tab: 'months' | 'brands') => void;
  onMonth: (kind: Kind, index: number, total: number | null) => void;
  onQuarter: (kind: Kind, quarter: number, total: number | null) => void;
  onBrandYear: (brand: string, kind: Kind, total: number | null) => void;
}) {
  const hqSum = (kind: Kind) => sumPaise(readMonths(sheet, place.id, '', kind));
  const brandSums = (kind: Kind) =>
    known.map((brand) => sumPaise(readMonths(sheet, place.id, brand, kind)));
  const gap = (kind: Kind) => gapPaise(hqSum(kind), brandSums(kind));
  const ly = (kind: Kind) =>
    sumPaise(MONTH_NAMES.map((_, index) => faintOf(place.id, '', kind, index)));
  return (
    <div>
      <h2 className="text-lg font-semibold text-[#0F2A4A]">
        {place.name}{' '}
        <span className="rounded-md bg-[#0CAAC1] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-white">
          BM HQ
        </span>
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {person ? `${person} · ` : ''}
        {year}. A quarter fills its three months. A brand year fills its twelve months.
      </p>
      <div className="mt-3 flex gap-3 text-sm">
        {(['months', 'brands'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`border-b-2 pb-1 capitalize ${
              tab === item
                ? 'border-[#0C8498] font-medium text-[#0C8498]'
                : 'border-transparent text-slate-500'
            }`}
            onClick={() => onTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {tab === 'months' && (
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="py-1">Month</th>
              <th className="text-right">Primary</th>
              <th className="text-right">Secondary</th>
            </tr>
          </thead>
          <tbody>
            {QUARTERS.map((quarter, quarterIndex) => (
              <QuarterBlock
                key={quarter.label}
                quarter={quarter}
                quarterIndex={quarterIndex}
                place={place.name}
                year={year}
                sheet={sheet}
                territoryId={place.id}
                disabled={disabled}
                faintOf={faintOf}
                onMonth={onMonth}
                onQuarter={onQuarter}
              />
            ))}
          </tbody>
        </table>
      )}
      {tab === 'brands' && (
        <BrandTable
          place={place.name}
          territoryId={place.id}
          year={year}
          known={known}
          catalog={brands}
          hints={brandHints}
          query={query}
          sheet={sheet}
          disabled={disabled}
          faintOf={faintOf}
          onBrandYear={onBrandYear}
        />
      )}
      <Foot
        cells={
          tab === 'brands'
            ? [
                { label: place.name, primary: hqSum('primary'), secondary: hqSum('secondary') },
                {
                  label: 'These brands',
                  primary: sumPaise(brandSums('primary')),
                  secondary: sumPaise(brandSums('secondary')),
                },
                {
                  label: 'Still to place',
                  primary: gap('primary'),
                  secondary: gap('secondary'),
                  tone: 'gap',
                },
              ]
            : [
                {
                  label: `${place.name} ${year}`,
                  primary: hqSum('primary'),
                  secondary: hqSum('secondary'),
                },
                { label: 'Last year', primary: ly('primary'), secondary: ly('secondary') },
              ]
        }
      />
    </div>
  );
}

function QuarterBlock({
  quarter,
  quarterIndex,
  place,
  year,
  sheet,
  territoryId,
  disabled,
  faintOf,
  onMonth,
  onQuarter,
}: {
  quarter: { label: string; range: string };
  quarterIndex: number;
  place: string;
  year: number;
  sheet: Sheet;
  territoryId: string;
  disabled: boolean;
  faintOf: (territoryId: string, brand: string, kind: Kind, index: number) => number | null;
  onMonth: (kind: Kind, index: number, total: number | null) => void;
  onQuarter: (kind: Kind, quarter: number, total: number | null) => void;
}) {
  const indexes = [quarterIndex * 3, quarterIndex * 3 + 1, quarterIndex * 3 + 2];
  return (
    <>
      <tr className="border-t bg-slate-50">
        <td className="py-2 font-medium text-[#0F2A4A]">
          {quarter.label} <span className="font-normal text-slate-500">{quarter.range}</span>
        </td>
        {KINDS.map((kind) => {
          const amount = sumPaise(
            indexes.map((index) => readMonths(sheet, territoryId, '', kind)[index] ?? null),
          );
          const faint = sumPaise(indexes.map((index) => faintOf(territoryId, '', kind, index)));
          return (
            <td key={kind}>
              <div className="flex justify-end">
                <MoneyField
                  label={`${place} ${quarter.label} ${kind} ${year}`}
                  paise={amount}
                  faint={faint}
                  disabled={disabled}
                  onCommit={(total) => onQuarter(kind, quarterIndex, total)}
                />
              </div>
            </td>
          );
        })}
      </tr>
      {indexes.map((index) => (
        <tr key={MONTH_NAMES[index]} className="border-t">
          <td className="py-2 pl-4 text-[#0F2A4A]">{MONTH_NAMES[index]}</td>
          {KINDS.map((kind) => (
            <td key={kind}>
              <div className="flex justify-end">
                <MoneyField
                  label={`${place} ${MONTH_NAMES[index]} ${kind} ${year}`}
                  paise={readMonths(sheet, territoryId, '', kind)[index] ?? null}
                  faint={faintOf(territoryId, '', kind, index)}
                  disabled={disabled}
                  onCommit={(total) => onMonth(kind, index, total)}
                />
              </div>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function BrandTable({
  place,
  territoryId,
  year,
  known,
  catalog,
  hints,
  query,
  sheet,
  disabled,
  faintOf,
  onBrandYear,
}: {
  place: string;
  territoryId: string;
  year: number;
  known: string[];
  catalog: string[];
  hints: Map<string, string>;
  query: string;
  sheet: Sheet;
  disabled: boolean;
  faintOf: (territoryId: string, brand: string, kind: Kind, index: number) => number | null;
  onBrandYear: (brand: string, kind: Kind, total: number | null) => void;
}) {
  const [added, setAdded] = useState<string[]>([]);
  const rows = [...new Set([...known, ...added])]
    .filter(
      (brand) =>
        !query ||
        brand.toLowerCase().includes(query) ||
        (hints.get(brand) ?? '').toLowerCase().includes(query),
    )
    .sort((a, b) => a.localeCompare(b));
  const remaining = catalog.filter((brand) => !known.includes(brand) && !added.includes(brand));
  return (
    <div className="mt-4">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1">Brand</th>
            <th className="text-right">Primary</th>
            <th className="text-right">Secondary</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((brand) => (
            <tr key={brand} className="border-t">
              <td className="py-2 font-medium text-[#0F2A4A]">{brand}</td>
              {KINDS.map((kind) => {
                const amount = sumPaise(readMonths(sheet, territoryId, brand, kind));
                const faint = sumPaise(
                  MONTH_NAMES.map((_, index) => faintOf(territoryId, brand, kind, index)),
                );
                return (
                  <td key={kind}>
                    <div className="flex justify-end">
                      <MoneyField
                        label={`${place} ${brand} ${kind} ${year}`}
                        paise={amount}
                        faint={faint}
                        disabled={disabled}
                        onCommit={(total) => onBrandYear(brand, kind, total)}
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {remaining.length > 0 && (
        <div className="mt-3 max-w-xs">
          <Combobox
            aria-label="Add a brand"
            placeholder="Add a brand"
            searchPlaceholder="Search a brand or product"
            emptyText="No brand matches."
            disabled={disabled}
            options={remaining.map((brand) => ({
              value: brand,
              label: brand,
              hint: hints.get(brand) ?? null,
            }))}
            value={[]}
            onValueChange={(ids) => {
              const brand = ids.at(-1);
              if (brand)
                setAdded((current) => (current.includes(brand) ? current : [...current, brand]));
            }}
          />
        </div>
      )}
    </div>
  );
}
