'use client';

import { useEffect, useState } from 'react';
import { apiReady, MOCKING } from '@/lib/api';
import { MOCK_PRODUCT_SEED } from '@/mocks/product-seed';
import { getProducts } from '@/lib/query';

/** Product id -> name. Mock mode uses the local seed of Arighna's 101 products (CONTRACT-GAPS #12). */
export function useProductNames() {
  const [names, setNames] = useState<Map<string, string>>(() =>
    MOCKING ? new Map(MOCK_PRODUCT_SEED.map((p) => [p.id, p.name])) : new Map(),
  );
  useEffect(() => {
    if (MOCKING) return;
    void (async () => {
      await apiReady();
      const r = await getProducts();
      setNames(new Map((r.data ?? []).map((p) => [p.id, p.name])));
    })().catch(() => {});
  }, []);
  return names;
}

export const productSample = () => MOCK_PRODUCT_SEED;
