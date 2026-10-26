import type { TableQuery, TableResult } from './types';

type CursorPage<T> = { items: T[]; nextCursor: string | null };

/**
 * Adapts the v1 cursor API ({ limit, cursor, q } -> { items, nextCursor }) to page-numbered tables.
 * Cursors are remembered per (query, filters, pageSize), so page N needs N-1 earlier requests only on a cold deep link.
 * The API reports no total, so `total` is null and the pager shows "Page N" with next/previous.
 */
export function cursorPager<T>(
  load: (args: { limit: number; cursor?: string; q?: string }, signal: AbortSignal) => Promise<CursorPage<T>>,
) {
  const cache = new Map<string, (string | undefined)[]>();
  return async function fetchPage(q: TableQuery, signal: AbortSignal): Promise<TableResult<T>> {
    const key = JSON.stringify([q.query, q.filters, q.pageSize, q.sort]);
    const cursors = cache.get(key) ?? [undefined];
    cache.set(key, cursors);
    let page: CursorPage<T> = { items: [], nextCursor: null };
    for (let p = 1; p <= q.page; p++) {
      if (p > 1 && cursors[p - 1] === undefined) break; // ran past the end
      if (p < q.page && cursors[p] !== undefined) continue;
      page = await load({ limit: q.pageSize, cursor: cursors[p - 1], q: q.query || undefined }, signal);
      if (page.nextCursor) cursors[p] = page.nextCursor;
      else if (p < q.page) return { items: [], total: null, hasNext: false };
    }
    return { items: page.items, total: null, hasNext: page.nextCursor !== null };
  };
}
