'use client';

import { QueryClient, useQuery } from '@tanstack/react-query';
import type { Territory } from '@ariforce/contracts';
import { api, apiReady } from '@/lib/api';

/**
 * One app-wide React Query cache. Reference data (territories, the signed-in user) is fetched once
 * and shared by every screen; doctor lookups are cached briefly by their exact query.
 * 401s still go through the api client's sign-out hook (lib/api onResponse), unchanged.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: false, refetchOnWindowFocus: false },
  },
});

/** Territories and /v1/me rarely change during a session. */
export const LONG_STALE = 30 * 60_000;
/** Doctor lists change when someone adds or edits a doctor; keep them short-lived. */
export const SHORT_STALE = 2 * 60_000;

class CachedApiError extends Error {
  constructor(public readonly apiError: unknown) {
    super('API request failed');
  }
}

/**
 * Run an openapi-fetch GET through the shared cache. Returns `{ data }` or `{ error }` like the
 * client does, so callers keep using `toApiError(r)`. Failures are not cached.
 */
export async function cachedGet<T>(
  key: readonly unknown[],
  run: () => Promise<{ data?: T; error?: unknown }>,
  staleTime = SHORT_STALE,
): Promise<{ data?: T; error?: unknown }> {
  try {
    const data = await queryClient.fetchQuery({
      queryKey: key,
      staleTime,
      queryFn: async () => {
        await apiReady();
        const r = await run();
        if (r.data === undefined) throw new CachedApiError(r.error);
        return r.data;
      },
    });
    return { data };
  } catch (e) {
    return { error: e instanceof CachedApiError ? e.apiError : e };
  }
}

/** Every territory (all pages, sorted by name), including deleted rows; callers filter. */
async function loadAllTerritories(): Promise<Territory[]> {
  await apiReady();
  const items: Territory[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await api.GET('/v1/territories', {
      params: { query: { limit: 200, sort: 'name', ...(cursor ? { cursor } : {}) } as never },
    });
    if (!r.data) throw new CachedApiError(r.error);
    items.push(...(r.data.items as Territory[]));
    cursor = r.data.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return items;
}

export const territoriesQuery = {
  queryKey: ['territories', 'all'] as const,
  queryFn: loadAllTerritories,
  staleTime: LONG_STALE,
};

/** The one cached territory list (replaces per-screen paged loops). */
export const getTerritories = () => queryClient.fetchQuery(territoriesQuery);
export const useTerritories = () => useQuery(territoriesQuery);
/** Call after creating, editing or deleting a territory. */
export const invalidateTerritories = () =>
  queryClient.invalidateQueries({ queryKey: territoriesQuery.queryKey });

/** Every product (all pages). Shared by DCR, classic DCR and Doctor 360. */
async function loadProducts() {
  await apiReady();
  const items = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await api.GET('/v1/products', {
      params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } as never },
    });
    if (!r.data) throw new CachedApiError(r.error);
    items.push(...r.data.items);
    cursor = r.data.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return items;
}
export const productsQuery = {
  queryKey: ['products', 'all'] as const,
  queryFn: loadProducts,
  staleTime: SHORT_STALE,
};
/** Same `{ data } | { error }` shape as the api client, so callers keep `toApiError(r)`. */
export const getProducts = () =>
  cachedGet(productsQuery.queryKey, async () => ({ data: await loadProducts() }));

async function loadMe() {
  await apiReady();
  const r = await api.GET('/v1/me');
  if (!r.data) throw new CachedApiError(r.error);
  return r.data;
}

export const meQuery = { queryKey: ['me'] as const, queryFn: loadMe, staleTime: LONG_STALE };
export const getMe = () => queryClient.fetchQuery(meQuery);
export const useMe = () => useQuery(meQuery);
