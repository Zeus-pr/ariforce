'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { PAGE_SIZES, type TableQuery } from './types';

/** Table state lives in the URL (?page=&size=&q=&sort=name.desc&f.territory=...), so it survives reloads and can be shared. */
export function useTableQuery(defaultPageSize = 25) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const query = useMemo<TableQuery>(() => {
    const size = Number(params.get('size'));
    const sortRaw = params.get('sort');
    const filters: Record<string, string> = {};
    params.forEach((v, k) => {
      if (k.startsWith('f.') && v) filters[k.slice(2)] = v;
    });
    return {
      page: Math.max(1, Number(params.get('page')) || 1),
      pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : defaultPageSize,
      query: params.get('q') ?? '',
      sort: sortRaw
        ? { id: sortRaw.replace(/\.desc$/, ''), desc: sortRaw.endsWith('.desc') }
        : null,
      filters,
    };
  }, [params, defaultPageSize]);

  const setQuery = useCallback(
    (patch: Partial<TableQuery>) => {
      const next = { ...query, ...patch };
      // Anything other than a page change sends you back to page 1.
      if (!('page' in patch)) next.page = 1;
      const sp = new URLSearchParams();
      params.forEach((v, k) => {
        if (!['page', 'size', 'q', 'sort'].includes(k) && !k.startsWith('f.')) sp.set(k, v);
      });
      if (next.page > 1) sp.set('page', String(next.page));
      if (next.pageSize !== defaultPageSize) sp.set('size', String(next.pageSize));
      if (next.query) sp.set('q', next.query);
      if (next.sort) sp.set('sort', `${next.sort.id}${next.sort.desc ? '.desc' : ''}`);
      for (const [k, v] of Object.entries(next.filters)) if (v) sp.set(`f.${k}`, v);
      const s = sp.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [query, params, pathname, router, defaultPageSize],
  );

  return [query, setQuery] as const;
}
