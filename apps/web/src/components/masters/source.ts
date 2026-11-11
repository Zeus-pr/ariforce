import { cursorPager } from '@/components/data-table/cursor-source';
import type { DataSource, FilterDef } from '@/components/data-table/types';
import { api, apiReady } from '@/lib/api';
import { MASTERS, type MasterKind, type MasterRow } from './config';
import type { Lookups } from './lookups';
import { masterTerritoryFilterOptions } from './territory-filter';

/** Table column id -> API sort key (`sort=name` / `sort=-name`). */
const SORT_KEYS: Record<string, string> = { name: 'name', city: 'city', updated: 'updatedAt' };
/** Table filter id -> API query param. Doctors filter by territory, specialty and category; chemists/stockists by territory. */
const FILTER_PARAMS: Record<MasterKind, string[]> = {
  doctors: ['territoryId', 'specialtyId', 'categoryId'],
  chemists: ['territoryId'],
  stockists: ['territoryId'],
};

const fetchers = new Map<MasterKind, DataSource<MasterRow>['fetch']>();

/** Server-side list: q, sort, filters, includeTotal and cursor paging all go to GET /v1/{kind}. */
export function masterSource(kind: MasterKind, lk: Lookups): DataSource<MasterRow> {
  let fetch = fetchers.get(kind);
  if (!fetch) {
    const path = MASTERS[kind].path;
    fetch = cursorPager<MasterRow>(async ({ limit, cursor, q, query: tq }, signal) => {
      await apiReady();
      const sortKey = tq.sort ? SORT_KEYS[tq.sort.id] : undefined;
      const filters = Object.fromEntries(
        FILTER_PARAMS[kind].filter((k) => tq.filters[k]).map((k) => [k, tq.filters[k]]),
      );
      const query = {
        limit,
        cursor,
        q,
        includeTotal: 'true' as const,
        ...(sortKey ? { sort: (tq.sort!.desc ? `-${sortKey}` : sortKey) as 'name' } : {}),
        ...filters,
      };
      const { data, error } = await api.GET(path, { params: { query }, signal });
      if (error || !data)
        throw new Error(
          (error as { error?: { message?: string } })?.error?.message ?? 'Could not load.',
        );
      return {
        items: data.items.filter((r) => !r.deletedAt),
        nextCursor: data.nextCursor,
        total: data.total,
      };
    });
    fetchers.set(kind, fetch);
  }
  const opt = (rows: { id: string; name: string }[]) =>
    rows.map((r) => ({ value: r.id, label: r.name }));
  const filters: FilterDef[] = [
    {
      id: 'territoryId',
      label: 'Territory',
      options: masterTerritoryFilterOptions(lk.territories),
    },
  ];
  if (kind === 'doctors')
    filters.push(
      { id: 'specialtyId', label: 'Specialty', options: opt(lk.specialties) },
      { id: 'categoryId', label: 'Category', options: opt(lk.categories) },
    );
  return { searchable: true, sortable: Object.keys(SORT_KEYS), filters, fetch };
}
