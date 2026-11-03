import type { Product } from '@ariforce/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

type ProductPage = {
  items: Product[];
  nextCursor: string | null;
  total?: number;
};

const PAGE_SIZE = 50;

export function useProducts(query: string) {
  return useInfiniteQuery({
    queryKey: ['products', 'catalog', query],
    initialPageParam: undefined as string | undefined,
    staleTime: 10 * 60_000,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<ProductPage>('/v1/products', {
        signal,
        query: {
          limit: PAGE_SIZE,
          cursor: pageParam,
          q: query || undefined,
          sort: 'name',
          includeTotal: 'true',
        },
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
