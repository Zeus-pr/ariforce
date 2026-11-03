'use client';

import type { DoctorCategory, Specialty, Territory } from '@ariforce/contracts';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, apiReady } from '@/lib/api';
import { getTerritories } from '@/lib/query';

export type Lookups = {
  territories: Territory[];
  specialties: Specialty[];
  categories: DoctorCategory[];
  byId: Map<string, string>;
  ready: boolean;
};

const empty: Lookups = {
  territories: [],
  specialties: [],
  categories: [],
  byId: new Map(),
  ready: false,
};
const Ctx = createContext<Lookups>(empty);

/** Reference data used for labels, filters, selects and import matching. Territories page through every cursor. */
export function LookupsProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Omit<Lookups, 'byId' | 'ready'> | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const q = { params: { query: { limit: 200 } } };
      const allTerritories = async () => ({ data: { items: await getTerritories() } });
      const [t, s, c] = await Promise.all([
        allTerritories(),
        api.GET('/v1/specialties', q),
        api.GET('/v1/doctor-categories', q),
      ]);
      if (live)
        setData({
          territories: (t.data?.items ?? []).filter((x) => !x.deletedAt),
          specialties: (s.data?.items ?? []).filter((x) => !x.deletedAt),
          categories: (c.data?.items ?? []).filter((x) => !x.deletedAt),
        });
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const value = useMemo<Lookups>(() => {
    if (!data) return empty;
    const byId = new Map<string, string>();
    for (const r of [...data.territories, ...data.specialties, ...data.categories])
      byId.set(r.id, r.name);
    return { ...data, byId, ready: true };
  }, [data]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLookups = () => useContext(Ctx);
