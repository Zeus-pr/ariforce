import { cursorPager } from '@/components/data-table/cursor-source';
import type { DataSource } from '@/components/data-table/types';
import { api, apiReady } from '@/lib/api';
import { MASTERS, type MasterKind, type MasterRow } from './config';

const sources = new Map<MasterKind, DataSource<MasterRow>>();

/**
 * v1 list endpoints support `q`, `limit` and `cursor` only. No sort, no filters, no total yet
 * (listed as contract gaps), so the table exposes search + paging and nothing it can't do server-side.
 */
export function masterSource(kind: MasterKind): DataSource<MasterRow> {
  let s = sources.get(kind);
  if (!s) {
    const path = MASTERS[kind].path;
    s = {
      searchable: true,
      sortable: [],
      filters: [],
      fetch: cursorPager<MasterRow>(async (query, signal) => {
        await apiReady();
        const { data, error } = await api.GET(path, { params: { query }, signal });
        if (error || !data) throw new Error((error as { error?: { message?: string } })?.error?.message ?? 'Could not load.');
        return { items: data.items.filter((r) => !r.deletedAt), nextCursor: data.nextCursor };
      }),
    };
    sources.set(kind, s);
  }
  return s;
}
