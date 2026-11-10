import type { CheckIn, Dcr } from '@ariforce/contracts';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { todayIST } from './dcr/dates';
import { listCheckInsInRange, type OutletKind } from './field';

const HISTORY_DAYS = 90;

const istDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function shiftIST(ymd: string, days: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

export type OutletVisit = {
  id: string;
  date: string;
  samples: number;
  pob: number | null;
  rcpa: number;
  remarks: string | null;
  inFence: boolean | null;
};

/** Real calls and visit check-ins for one outlet. Drafts and rejected reports are left out. */
export function outletVisits(
  kind: OutletKind,
  outletId: string,
  dcrs: Dcr[],
  checkIns: CheckIn[],
): OutletVisit[] {
  const ci = checkIns.filter((c) => c.outletKind === kind && c.outletId === outletId);
  const out: OutletVisit[] = [];
  for (const d of dcrs) {
    if (d.status === 'draft' || d.status === 'rejected') continue;
    for (const c of d.calls) {
      if (c.outletKind !== kind || c.outletId !== outletId) continue;
      const geo = ci.find((x) => x.id === c.checkInId);
      const pob = c.pob.reduce((s, l) => s + (l.value ?? 0), 0);
      out.push({
        id: c.id,
        date: d.date,
        samples: c.samples.reduce((s, l) => s + l.quantity, 0),
        pob: c.pob.length ? pob : null,
        rcpa: c.rcpa.length,
        remarks: c.remarks,
        inFence: geo ? geo.inFence : null,
      });
    }
  }
  for (const c of ci) {
    const date = istDay.format(new Date(c.capturedAt));
    if (out.some((v) => v.date === date)) continue;
    out.push({
      id: c.id,
      date,
      samples: 0,
      pob: null,
      rcpa: 0,
      remarks: null,
      inFence: c.inFence,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export function useOutletActivity(kind: OutletKind, outletId: string) {
  const to = todayIST();
  const from = shiftIST(to, -HISTORY_DAYS);
  return useQuery({
    queryKey: ['outlet-activity', kind, outletId, from, to],
    queryFn: async () => {
      const [dcrs, checkIns] = await Promise.all([
        apiFetch<{ items: Dcr[] }>('/v1/dcrs', {
          query: { from, to, sort: '-date', limit: 200 },
        }),
        listCheckInsInRange(from, to),
      ]);
      return outletVisits(kind, outletId, dcrs.items ?? [], checkIns);
    },
  });
}
