import type { DataSource, FilterDef, TableQuery, TableResult } from './types';

/**
 * A DataSource over rows the page already derived (no list endpoint exists for them yet).
 * Speaks the same TableQuery as the server tables, so swapping in a real endpoint later is a one-line change.
 */
export function memorySource<T>(
  rows: T[],
  opts: {
    filters?: FilterDef[];
    match?: (row: T, filterId: string, value: string) => boolean;
    text?: (row: T) => string;
    sort?: Record<string, (row: T) => string | number>;
  },
): DataSource<T> {
  return {
    sortable: Object.keys(opts.sort ?? {}),
    filters: opts.filters ?? [],
    searchable: !!opts.text,
    async fetch(q: TableQuery): Promise<TableResult<T>> {
      let out = rows.filter((r) =>
        Object.entries(q.filters).every(([id, v]) => !v || !opts.match || opts.match(r, id, v)),
      );
      const t = q.query.trim().toLowerCase();
      if (t && opts.text) out = out.filter((r) => opts.text!(r).toLowerCase().includes(t));
      const key = q.sort && opts.sort?.[q.sort.id];
      if (key) {
        const dir = q.sort!.desc ? -1 : 1;
        out = [...out].sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : 0));
      }
      const start = (q.page - 1) * q.pageSize;
      return { items: out.slice(start, start + q.pageSize), total: out.length, hasNext: start + q.pageSize < out.length };
    },
  };
}
