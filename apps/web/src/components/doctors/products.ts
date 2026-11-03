'use client';

import { useEffect, useState } from 'react';
import { apiReady } from '@/lib/api';
import { getProducts } from '@/lib/query';

/** Product id -> name from GET /v1/products. */
export function useProductNames() {
  const [names, setNames] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    void (async () => {
      await apiReady();
      const r = await getProducts();
      setNames(new Map((r.data ?? []).map((p) => [p.id, p.name])));
    })().catch(() => {});
  }, []);
  return names;
}
