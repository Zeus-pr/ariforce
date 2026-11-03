'use client';

import dynamic from 'next/dynamic';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@ariforce/ui/components/button';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
import { formatKpi, HEADLINE, KPI_META, TEAM_COLUMNS } from '@/components/dashboard/kpi-meta';
import { ExportMenu } from '@/components/export/export-menu';
import { api, apiReady } from '@/lib/api';
import { monthLabel, thisMonth } from '@/lib/period';
import { getMe, getTerritories } from '@/lib/query';

const TeamCoverageChart = dynamic(() => import('./team-charts').then((m) => m.TeamCoverageChart), {
  ssr: false,
  loading: () => (
    <div className="h-[220px] animate-pulse rounded-md bg-muted/40" aria-busy="true" />
  ),
});

const LEVEL: Record<Territory['level'], string> = {
  national: 'Country',
  zone: 'Zone',
  region: 'Region',
  area: 'Area',
  headquarter: 'HQ',
  territory: 'Territory',
};
const COLS = [...TEAM_COLUMNS, 'dcr_compliance_pct', 'pob_value'] as const;
const noop = () => () => {};

type Row = KpiReport['rows'][number];

async function kpis(query: Record<string, string>) {
  await apiReady();
  const r = await api.GET('/v1/kpis', { params: { query: query as never } });
  return r.data ?? null;
}

export function TeamView() {
  const month = useSyncExternalStore(noop, thisMonth, () => null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tree, setTree] = useState<Territory[] | null>(null);
  const [home, setHome] = useState<string | null>(null);
  // Results are keyed by the view they belong to, so a drill never shows the previous level's rows.
  const [loaded, setLoaded] = useState<{
    key: string;
    scope: KpiReport | null;
    rows: Row[];
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
    })().catch(() => {});
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
  const person = userId ? rows?.find((r) => r.userId === userId) : undefined;

  useEffect(() => {
    if (!month || !t) return;
    let live = true;
    void (async () => {
      const head = await kpis(
        userId
          ? { month, rollup: 'self', userId, kpis: HEADLINE.join(',') }
          : { month, rollup: 'byTerritory', territoryId: t, kpis: HEADLINE.join(',') },
      );
      const list =
        leaf || userId
          ? await kpis({ month, rollup: 'byUser', territoryId: t, kpis: COLS.join(',') })
          : await kpis({ month, rollup: 'byTerritory', territoryId: t, kpis: COLS.join(',') });
      if (!live) return;
      setLoaded({
        key: `${month}|${t}|${userId}|${leaf}`,
        scope:
          head && !userId ? { ...head, rows: head.rows.filter((r) => r.territoryId === t) } : head,
        rows:
          leaf || userId
            ? (list?.rows ?? [])
            : (list?.rows ?? []).filter((r) => r.territoryId !== t),
      });
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [month, t, leaf, userId]);

  const go = (q: { t?: string; u?: string | null }) => {
    const s = new URLSearchParams(params.toString());
    if (q.t) s.set('t', q.t);
    if (q.u === null) s.delete('u');
    else if (q.u) s.set('u', q.u);
    router.push(`${pathname}?${s.toString()}`, { scroll: false });
  };

  const metric = (r: Row, k: string) => r.metrics.find((m) => m.kpi === k);
  const chart = (rows ?? []).map((r) => ({
    name: r.label,
    coverage: metric(r, 'coverage_pct')?.value ?? 0,
  }));
  const title = person ? person.label : node ? `${node.name}` : 'Team';
  const listLabel = leaf ? 'People' : LEVEL[children[0]?.level ?? 'area'] + 's';

  const spec = () => ({
    title: `Team performance: ${[...trail.map((x) => x.name), person?.label].filter(Boolean).join(' › ')}`,
    meta: [
      `${monthLabel(month!)} · exported ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
      'KPI formulas are drafts, to confirm with Arighna (docs/kpi-definitions.md).',
    ],
    columns: [
      { header: listLabel.replace(/s$/, ''), width: 28 },
      ...COLS.map((k) => ({ header: KPI_META[k].label, align: 'right' as const })),
    ],
    rows: (rows ?? []).map((r) => [r.label, ...COLS.map((k) => metric(r, k)?.value ?? null)]),
    fileName: `ariforce-team-${(node?.code ?? 'all').toLowerCase()}-${month}`,
  });

  if (!month || !tree) return <div className="h-96" aria-busy="true" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        {person?.userId && (
          <Button asChild size="sm">
            <Link href={`/team/members/${person.userId}`} data-testid="open-profile">
              View full profile
            </Link>
          </Button>
        )}
        <ExportMenu spec={spec} disabled={!rows} />
      </div>

      <div>
        <p className="text-xs text-muted-foreground" data-testid="team-scope">
          {person ? 'Business Manager' : node ? LEVEL[node.level] : ''} · {monthLabel(month)}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
      </div>

      <KpiCards metrics={scope?.rows[0]?.metrics ?? []} error={null} loading={!scope} />

      {!person && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="gap-0 py-0 shadow-xs">
            <CardHeader className="border-b px-4 py-4">
              <CardTitle className="text-base" data-testid="team-list-title">
                {listLabel}
              </CardTitle>
              <CardDescription>
                {leaf ? 'Select a person for their numbers.' : 'Select a row to drill down.'}
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <Table data-testid="team-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">{listLabel.replace(/s$/, '')}</TableHead>
                    {COLS.map((k) => (
                      <TableHead key={k} className="text-right last:pr-4">
                        {KPI_META[k].label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(rows ?? []).map((r, i) => (
                    <TableRow
                      key={r.userId ?? r.territoryId ?? r.label}
                      data-testid="team-row"
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
                              m && m.denominator != null
                                ? `${m.numerator} ÷ ${m.denominator}`
                                : undefined
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
                        No one reports into this territory yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
          <Card className="gap-0 py-0 shadow-xs">
            <CardHeader className="px-4 pt-4 pb-0">
              <CardTitle className="text-sm">
                Coverage by {listLabel.replace(/s$/, '').toLowerCase()}
              </CardTitle>
            </CardHeader>
            <div className="px-2 pb-2">
              <TeamCoverageChart chart={chart} listLabel={listLabel} />
            </div>
          </Card>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        KPI formulas are drafts, to confirm with Arighna. Numbers sum numerators and denominators up
        the hierarchy.
      </p>
    </div>
  );
}
