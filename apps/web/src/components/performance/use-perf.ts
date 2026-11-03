'use client';

import { useEffect, useState } from 'react';
import type { KpiReport } from '@ariforce/contracts';
import { rollupFor } from '@/components/dashboard/rollup';
import { api, apiReady, toApiError } from '@/lib/api';
import { addMonths } from '@/lib/period';
import { isApprover, type Role } from '@/lib/roles';
import { getTerritories } from '@/lib/query';

export type Row = KpiReport['rows'][number];
export type Metric = Row['metrics'][number];
export const TREND_MONTHS = 6;

/** Breakdown rows by role: Director by territory (top level's children), managers by person, a BM only themself. */
export function breakdownFor(role: Role): 'byTerritory' | 'byUser' | null {
  if (role === 'director') return 'byTerritory';
  return isApprover(role) ? 'byUser' : null;
}

async function get(query: Record<string, string>) {
  await apiReady();
  const r = await api.GET('/v1/kpis', { params: { query: query as never } });
  if (r.error) throw new Error(toApiError(r).message);
  return r.data!;
}

/** Headline + breakdown for one month, and a headline trend over the last six months. */
export function usePerf(role: Role, month: string | null, kpis: readonly string[]) {
  const [state, setState] = useState<{
    head: Row | null;
    rows: Row[];
    trend: { month: string; row: Row | null }[];
    error: string | null;
  } | null>(null);
  const key = kpis.join(',');
  useEffect(() => {
    if (!month) return;
    let live = true;
    setState(null);
    void (async () => {
      try {
        const rollup = rollupFor(role);
        const by = breakdownFor(role);
        const months = Array.from({ length: TREND_MONTHS }, (_, i) =>
          addMonths(month, i - TREND_MONTHS + 1),
        );
        let root: string | undefined;
        if (by === 'byTerritory') {
          await apiReady();
          const t = await getTerritories();
          root = t.find((x) => x.parentId === null && !x.deletedAt)?.id;
        }
        const [head, rows, ...trend] = await Promise.all([
          get({ month, rollup, kpis: key }),
          by
            ? get({ month, rollup: by, kpis: key, ...(root ? { territoryId: root } : {}) })
            : Promise.resolve(null),
          ...months.map((m) => get({ month: m, rollup, kpis: key })),
        ]);
        if (!live) return;
        // byTerritory returns the top territory with its children; list the children.
        const list = (rows?.rows ?? head.rows).filter((r) => !root || r.territoryId !== root);
        setState({
          head: head.rows[0] ?? null,
          rows: list,
          trend: months.map((m, i) => ({ month: m, row: trend[i]!.rows[0] ?? null })),
          error: null,
        });
      } catch (e) {
        if (live)
          setState({
            head: null,
            rows: [],
            trend: [],
            error: e instanceof Error ? e.message : 'Could not load.',
          });
      }
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [role, month, key]);
  return state;
}

export const pick = (r: Row | null | undefined, k: string) => r?.metrics.find((m) => m.kpi === k);
export const val = (r: Row | null | undefined, k: string) => pick(r, k)?.value ?? null;
