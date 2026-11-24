'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import NumberFlow from '@number-flow/react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Button } from '@ariforce/ui/components/button';
import { DeskPageSkeleton } from '@/components/shell/page-skeletons';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { KpiReport, Territory } from '@ariforce/contracts';
import { Card, CardDescription, CardHeader, CardTitle } from '@ariforce/ui/components/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@ariforce/ui/components/table';
import { cn } from '@ariforce/ui/lib/utils';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { TeamCoverageChart } from '@/components/team/team-charts';
import { formatKpi, HEADLINE, KPI_META, TEAM_COLUMNS } from '@/components/dashboard/kpi-meta';
import { ExportMenu } from '@/components/export/export-menu';
import { useMonth } from '@/components/performance/perf-ui';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { api, apiReady, toApiError } from '@/lib/api';
import { addMonths, monthLabel, thisMonth } from '@/lib/period';
import { getMe, getTerritories } from '@/lib/query';

/** A full bar is a strong full-day doctor call average. The number beside it is the real figure. */
const CALL_FULL = 12;

const LEVEL: Record<Territory['level'], string> = {
  national: 'Country',
  zone: 'State',
  region: 'RBM HQ',
  area: 'ABM HQ',
  headquarter: 'BM HQ',
  territory: 'Territory',
};
const COLS = [...TEAM_COLUMNS, 'dcr_compliance_pct', 'pob_value'] as const;
const monthShort = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });

type Row = KpiReport['rows'][number];

async function kpis(query: Record<string, string>) {
  await apiReady();
  const r = await api.GET('/v1/kpis', { params: { query: query as never } });
  if (r.error || !r.data) throw new Error(toApiError(r).message || 'Could not load this team.');
  return r.data;
}

function rowKey(r: Row) {
  return r.userId ?? r.territoryId ?? r.label;
}

function valueOf(r: Row | undefined, key: string) {
  return r?.metrics.find((m) => m.kpi === key)?.value ?? null;
}

export function TeamView() {
  const month = useMonth();
  const reduced = useReducedMotion();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tree, setTree] = useState<Territory[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  // Results are keyed by the view they belong to, so a drill never shows the previous level's rows.
  const [failed, setFailed] = useState<string | null>(null);
  const [numbers, setNumbers] = useState(false);
  const [loaded, setLoaded] = useState<{
    key: string;
    scope: KpiReport | null;
    rows: Row[];
    prevScope: KpiReport | null;
    prevRows: Row[];
  } | null>(null);

  const userId = params.get('u');
  const t = params.get('t') ?? home;

  useEffect(() => {
    void (async () => {
      await apiReady();
      const [ter, me] = await Promise.all([getTerritories(), getMe().catch(() => null)]);
      const list = ter.filter((x) => !x.deletedAt);
      setTree(list);
      // Start at the caller's own territory; a Director (or anyone without one) starts at the top.
      const own = me?.territoryIds.find((id) => list.some((x) => x.id === id));
      const root = list.find((x) => x.parentId === null);
      setHome(me?.roles.includes('director') || !own ? (root?.id ?? null) : own);
    })().catch((e) => {
      setTreeError(e instanceof Error ? e.message : 'Could not load the hierarchy.');
      setTree([]);
    });
  }, []);

  const byId = useMemo(() => new Map((tree ?? []).map((x) => [x.id, x])), [tree]);
  const node = t ? byId.get(t) : undefined;
  const children = useMemo(() => (tree ?? []).filter((x) => x.parentId === t), [tree, t]);
  const leaf = !!node && children.length === 0;
  const trail = useMemo(() => {
    const out: Territory[] = [];
    for (let n = node; n; n = n.parentId ? byId.get(n.parentId) : undefined) {
      out.unshift(n);
      if (n.id === home) break;
    }
    return out;
  }, [node, byId, home]);
  const viewKey = `${month}|${t}|${userId}|${leaf}`;
  const scope = loaded?.key === viewKey ? loaded.scope : null;
  const rows = loaded?.key === viewKey ? loaded.rows : null;
  const prevRows = loaded?.key === viewKey ? loaded.prevRows : null;
  const person = userId ? rows?.find((r) => r.userId === userId) : undefined;

  useEffect(() => {
    if (!month || !t) return;
    let live = true;
    setFailed(null);
    setNumbers(false);
    const prev = addMonths(month, -1);
    const headline = HEADLINE.join(',');
    const cols = COLS.join(',');
    void (async () => {
      const headFor = (m: string) =>
        userId
          ? kpis({ month: m, rollup: 'self', userId, kpis: headline })
          : kpis({ month: m, rollup: 'byTerritory', territoryId: t, kpis: headline });
      const listFor = (m: string) =>
        leaf || userId
          ? kpis({ month: m, rollup: 'byUser', territoryId: t, kpis: cols })
          : kpis({ month: m, rollup: 'byTerritory', territoryId: t, kpis: cols });
      const [head, list, prevHead, prevList] = await Promise.all([
        headFor(month),
        listFor(month),
        headFor(prev),
        listFor(prev),
      ]);
      if (!live) return;
      const scopeOf = (report: KpiReport) =>
        userId ? report : { ...report, rows: report.rows.filter((r) => r.territoryId === t) };
      const rowsOf = (report: KpiReport) =>
        leaf || userId
          ? report.rows.filter((r) => r.userId)
          : report.rows.filter((r) => r.territoryId && r.territoryId !== t);
      setLoaded({
        key: `${month}|${t}|${userId}|${leaf}`,
        scope: scopeOf(head),
        rows: rowsOf(list),
        prevScope: scopeOf(prevHead),
        prevRows: rowsOf(prevList),
      });
    })().catch((e) => {
      if (!live) return;
      setFailed(e instanceof Error ? e.message : 'Could not load this team.');
      setLoaded({
        key: `${month}|${t}|${userId}|${leaf}`,
        scope: null,
        rows: [],
        prevScope: null,
        prevRows: [],
      });
    });
    return () => {
      live = false;
    };
  }, [month, t, leaf, userId]);

  const go = (q: { t?: string; u?: string | null; m?: string }) => {
    const s = new URLSearchParams(params.toString());
    if (q.t) s.set('t', q.t);
    if (q.u === null) s.delete('u');
    else if (q.u) s.set('u', q.u);
    if (q.m) {
      if (q.m === thisMonth()) s.delete('m');
      else s.set('m', q.m);
    }
    router.push(`${pathname}${s.size ? `?${s}` : ''}`, { scroll: false });
  };

  const metric = (r: Row, k: string) => r.metrics.find((m) => m.kpi === k);
  const prevBy = new Map((prevRows ?? []).map((r) => [rowKey(r), r]));
  const ranked = [...(rows ?? [])].sort((a, b) => {
    const av = valueOf(a, 'call_average');
    const bv = valueOf(b, 'call_average');
    if (av == null && bv == null) return a.label.localeCompare(b.label);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av || a.label.localeCompare(b.label);
  });
  const now = thisMonth();
  const railEnd = month && month < addMonths(now, -5) ? month : now;
  const rail = Array.from({ length: 6 }, (_, i) => addMonths(railEnd, i - 5));
  const years = new Set(rail.map((item) => item.slice(0, 4)));
  const title = person ? person.label : node ? `${node.name}` : 'Team';
  const listLabel = leaf ? 'People' : (LEVEL[children[0]?.level ?? 'territory'] ?? 'Places');

  const spec = () => ({
    title: `Team performance: ${[...trail.map((x) => x.name), person?.label].filter(Boolean).join(' › ')}`,
    meta: [
      `${monthLabel(month!)} · exported ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
      'KPI formulas are drafts, to confirm with Arighna (docs/kpi-definitions.md).',
    ],
    columns: [
      { header: listLabel, width: 28 },
      ...COLS.map((k) => ({ header: KPI_META[k].label, align: 'right' as const })),
    ],
    rows: (rows ?? []).map((r) => [r.label, ...COLS.map((k) => metric(r, k)?.value ?? null)]),
    fileName: `ariforce-team-${(node?.code ?? 'all').toLowerCase()}-${month}`,
  });

  if (!month || !tree) return <DeskPageSkeleton embedded />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex max-w-full items-center gap-1 overflow-x-auto"
          data-testid="team-month"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => go({ m: addMonths(month, -1) })}
          >
            <ChevronLeft />
          </Button>
          <SegmentedControl
            label="Month"
            value={month}
            onValueChange={(next) => go({ m: next })}
            options={rail.map((item) => ({
              value: item,
              label:
                years.size > 1
                  ? `${monthShort.format(new Date(`${item}-01T00:00:00Z`))} ${item.slice(2, 4)}`
                  : monthShort.format(new Date(`${item}-01T00:00:00Z`)),
            }))}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            disabled={month >= now}
            onClick={() => go({ m: addMonths(month, 1) })}
          >
            <ChevronRight />
          </Button>
          {month === now && <span className="text-sm text-muted-foreground">So far</span>}
        </div>
        <div className="flex items-center gap-2">
          {person?.userId && (
            <Button asChild size="sm">
              <Link href={`/team/members/${person.userId}`} data-testid="open-profile">
                View full profile
              </Link>
            </Button>
          )}
          <ExportMenu spec={spec} disabled={!rows} />
        </div>
      </div>

      <nav aria-label="Hierarchy" data-testid="breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 text-sm">
          {trail.map((x, i) => {
            const current = i === trail.length - 1 && !person;
            return (
              <li key={x.id} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />}
                {current ? (
                  <span aria-current="page" className="font-medium">
                    {x.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    onClick={() => go({ t: x.id, u: null })}
                  >
                    {x.name}
                  </button>
                )}
              </li>
            );
          })}
          {person && (
            <li className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
              <span aria-current="page" className="font-medium">
                {person.label}
              </span>
            </li>
          )}
        </ol>
      </nav>

      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="team-scope">
          {node ? LEVEL[node.level] : 'Team'} · {monthLabel(month)}
        </p>
      </div>

      {treeError && (
        <p role="alert" className="text-sm text-destructive">
          {treeError}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {failed}
        </p>
      )}
      {(rows === null || (scope?.rows[0]?.metrics.length ?? 0) > 0) && !failed && (
        <KpiCards
          metrics={scope?.rows[0]?.metrics ?? []}
          compare={loaded?.key === viewKey ? loaded.prevScope?.rows[0]?.metrics : null}
          compareLabel={monthShort.format(new Date(`${addMonths(month, -1)}-01T00:00:00Z`))}
          error={null}
          loading={rows === null}
        />
      )}

      {!person && !failed && (
        <div className="flex flex-col gap-5">
          <div className="overflow-hidden rounded-lg border bg-card" data-testid="team-rank">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4">
              <div>
                <h3 className="text-base font-medium" data-testid="team-list-title">
                  {listLabel}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {leaf
                    ? 'Ranked by doctor call average. Select a person for their numbers.'
                    : 'Ranked by doctor call average. Select a row to drill down.'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={numbers}
                onClick={() => setNumbers((open) => !open)}
              >
                {numbers ? 'Hide all numbers' : 'All numbers'}
              </Button>
            </div>
            {rows === null ? (
              <div className="px-4 py-8" aria-busy="true">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              </div>
            ) : ranked.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {leaf ? 'No one is assigned to this place.' : 'Nothing under this place yet.'}
              </p>
            ) : (
              <LayoutGroup>
                <div className="min-w-0 border-b px-2 py-3">
                  <TeamCoverageChart
                    chart={ranked.map((row) => ({
                      name: row.label,
                      value: valueOf(row, 'call_average') ?? 0,
                    }))}
                    label="Doctor call average"
                    percent={false}
                  />
                </div>
                <ol>
                  {ranked.map((r) => {
                    const call = valueOf(r, 'call_average');
                    const coverage = valueOf(r, 'coverage_pct');
                    const previous = valueOf(prevBy.get(rowKey(r)), 'call_average');
                    const delta = call != null && previous != null ? call - previous : null;
                    const flat = delta != null && Math.abs(delta) < 0.05;
                    return (
                      <motion.li
                        key={rowKey(r)}
                        layout={reduced ? false : 'position'}
                        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                        className="border-b last:border-b-0"
                      >
                        <button
                          type="button"
                          data-testid="team-row"
                          className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
                          onClick={() =>
                            leaf ? go({ u: r.userId }) : go({ t: r.territoryId!, u: null })
                          }
                        >
                          <span
                            data-testid="team-row-name"
                            className="inline-flex min-w-0 items-center gap-1 font-medium"
                          >
                            <span className="truncate">{r.label}</span>
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                          </span>
                          <span className="text-right text-lg font-semibold tabular-nums">
                            {call == null ? (
                              '—'
                            ) : (
                              <NumberFlow
                                value={call}
                                locales="en-IN"
                                format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
                              />
                            )}
                          </span>
                          <div className="col-span-2 flex flex-col gap-1.5">
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                                style={{
                                  width: `${call == null ? 0 : Math.max(0, Math.min(100, (call / CALL_FULL) * 100))}%`,
                                  background: 'var(--chart-1)',
                                }}
                              />
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                                  style={{
                                    width: `${coverage == null ? 0 : Math.max(0, Math.min(100, coverage))}%`,
                                    background: 'var(--chart-6)',
                                  }}
                                />
                              </span>
                              <span className="tabular-nums">
                                {coverage == null ? '—' : formatKpi(coverage, 'percent')} coverage
                              </span>
                              {delta != null && (
                                <span
                                  className={cn(
                                    'ml-auto tabular-nums',
                                    flat
                                      ? 'text-muted-foreground'
                                      : delta > 0
                                        ? 'text-success'
                                        : 'text-destructive',
                                  )}
                                >
                                  {flat
                                    ? `0 vs ${monthShort.format(new Date(`${addMonths(month, -1)}-01T00:00:00Z`))}`
                                    : `${delta > 0 ? '+' : '−'}${formatKpi(Math.abs(delta), 'ratio')} vs ${monthShort.format(new Date(`${addMonths(month, -1)}-01T00:00:00Z`))}`}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </motion.li>
                    );
                  })}
                </ol>
              </LayoutGroup>
            )}
          </div>
          {numbers && (
            <Card className="gap-0 py-0 shadow-xs">
              <CardHeader className="border-b px-4 py-4">
                <CardTitle className="text-base">All numbers</CardTitle>
                <CardDescription>The same people, with every figure.</CardDescription>
              </CardHeader>
              <div className="overflow-x-auto">
                <Table data-testid="team-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">{listLabel}</TableHead>
                      {COLS.map((k) => (
                        <TableHead key={k} className="text-right last:pr-4">
                          {KPI_META[k].label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows === null && (
                      <TableRow>
                        <TableCell colSpan={COLS.length + 1} className="py-8" aria-busy="true">
                          <div className="mx-auto h-4 w-40 animate-pulse rounded bg-muted" />
                        </TableCell>
                      </TableRow>
                    )}
                    {(rows ?? []).map((r, i) => (
                      <TableRow
                        key={r.userId ?? r.territoryId ?? r.label}
                        tabIndex={0}
                        style={{ '--i': i } as React.CSSProperties}
                        className="af-enter cursor-pointer"
                        onClick={() =>
                          leaf ? go({ u: r.userId }) : go({ t: r.territoryId!, u: null })
                        }
                        onKeyDown={(e) =>
                          e.key === 'Enter' &&
                          (leaf ? go({ u: r.userId }) : go({ t: r.territoryId!, u: null }))
                        }
                      >
                        <TableCell className="pl-4 font-medium">
                          <span className="inline-flex items-center gap-1">
                            {r.label}
                            <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                          </span>
                        </TableCell>
                        {COLS.map((k) => {
                          const m = metric(r, k);
                          return (
                            <TableCell
                              key={k}
                              className={cn('text-right tabular-nums last:pr-4')}
                              title={
                                m && m.denominator ? `${m.numerator} ÷ ${m.denominator}` : undefined
                              }
                            >
                              {m ? formatKpi(m.value, m.unit) : '—'}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                    {rows?.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={COLS.length + 1}
                          className="py-8 text-center text-muted-foreground"
                        >
                          {leaf
                            ? 'No one is assigned to this place.'
                            : 'Nothing under this place yet.'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        KPI formulas are drafts, to confirm with Arighna. Numbers sum numerators and denominators up
        the hierarchy.
      </p>
    </div>
  );
}
