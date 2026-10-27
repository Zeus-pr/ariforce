'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LeaveBalanceItem, LeaveSettings, LeaveType } from '@/lib/leave/model';
import { api, apiReady, toApiError } from '@/lib/api';
import { leaveMessage, type LeaveReq } from '@/lib/leave/model';

type Settings = Omit<LeaveSettings, never>;
export type LeaveData = {
  types: LeaveType[];
  settings: Settings | null;
  balances: LeaveBalanceItem[] | null;
  mine: LeaveReq[] | null;
  error: string | null;
  reload: () => void;
};

/** Types, settings, this year's balances and my requests. */
/** `who` (role or user id) refetches when the signed-in or previewed person changes. */
export function useLeave(year: number, who: string): LeaveData {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [balances, setBalances] = useState<LeaveBalanceItem[] | null>(null);
  const [mine, setMine] = useState<LeaveReq[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      await apiReady();
      const signal = ac.signal;
      const [t, s, b, r] = await Promise.all([
        api.GET('/v1/leave/types', { signal }),
        api.GET('/v1/leave/settings', { signal }),
        api.GET('/v1/leave/balances', { params: { query: { year } }, signal }),
        api.GET('/v1/leave/requests', { params: { query: { mine: 'true', year } }, signal }),
      ]).catch(() => [] as never[]);
      if (ac.signal.aborted || !t) return;
      const bad = [t, s, b, r].find((x) => x.error);
      setError(bad ? leaveMessage(toApiError(bad)) : null);
      setTypes((t.data?.items ?? []).filter((x) => x.active).sort((a, z) => a.sortOrder - z.sortOrder));
      setSettings(s.data ?? null);
      setBalances(b.data?.items ?? []);
      setMine([...(r.data?.items ?? [])].sort((a, z) => z.fromDate.localeCompare(a.fromDate)));
    })().catch(() => {});
    return () => ac.abort();
  }, [year, tick, who]);

  return { types, settings, balances, mine, error, reload };
}
