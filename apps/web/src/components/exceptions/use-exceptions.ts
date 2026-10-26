'use client';

import { useEffect, useState } from 'react';
import { api, apiReady } from '@/lib/api';
import { isApprover, type Role } from '@/lib/roles';
import { addMonths, monthStart, thisMonth, todayYmd } from '@/lib/period';
import {
  fromApprovals,
  fromAttendance,
  fromCheckIns,
  fromDcrs,
  fromKpis,
  fromTourPlan,
  SAMPLE_EXCEPTIONS,
  sortExceptions,
  type Exception,
} from './rules';

/** Runs every rule over the contract data the caller can see. Managers get their team; a BM gets their own. */
export function useExceptions(role: Role) {
  const [rows, setRows] = useState<Exception[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const today = todayYmd();
      const month = thisMonth();
      const next = addMonths(month, 1);
      const team = isApprover(role);
      const [me, kpis, att, ci, dcrs, tp, appr, docs] = await Promise.all([
        api.GET('/v1/me'),
        api.GET('/v1/kpis', { params: { query: { month, rollup: team ? 'byUser' : 'self' } as never } }),
        api.GET('/v1/attendance', { params: { query: { from: monthStart(month), to: today, limit: 200 } } }),
        api.GET('/v1/check-ins', { params: { query: { from: monthStart(month), to: today, kind: 'visit', limit: 200 } } }),
        api.GET('/v1/dcrs', { params: { query: { from: monthStart(month) < today ? monthStart(month) : today, to: today, limit: 200 } } }),
        api.GET('/v1/tour-plans/{month}', { params: { path: { month: next } } }),
        team ? api.GET('/v1/approvals', { params: { query: { status: 'pending', limit: 100 } } }) : Promise.resolve(null),
        api.GET('/v1/doctors', { params: { query: { limit: 200 } } }),
      ]);
      if (!live) return;
      if (!me.data) {
        setError('Could not load your profile.');
        return;
      }
      const self = { id: me.data.id, name: me.data.name };
      const names = new Map((docs.data?.items ?? []).map((d) => [d.id, d.name]));
      const people = new Map((att.data?.items ?? []).map((d) => [d.userId, d.userName]));
      const who = (id: string) => people.get(id) ?? (id === self.id ? self.name : 'Team member');
      setRows(
        sortExceptions([
          ...fromKpis(kpis.data ?? null, today),
          ...fromAttendance(att.data?.items ?? [], today),
          ...fromCheckIns(ci.data?.items ?? [], names, who),
          ...fromDcrs(dcrs.data?.items ?? [], today, self),
          ...fromTourPlan(tp.data ?? null, next, today, self),
          ...(appr?.data ? fromApprovals(appr.data.items, today) : []),
          ...SAMPLE_EXCEPTIONS,
        ]),
      );
    })();
    return () => {
      live = false;
    };
  }, [role]);
  return { rows, error };
}
