'use client';

import { useEffect, useState } from 'react';
import { api, apiReady } from '@/lib/api';

/** Product id -> name from GET /v1/products. */
export function useProductNames() {
  const [names, setNames] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/products', { params: { query: { limit: 200 } } });
      setNames(new Map((r.data?.items ?? []).map((p) => [p.id, p.name])));
    })().catch(() => {});
  }, []);
  return names;
}
