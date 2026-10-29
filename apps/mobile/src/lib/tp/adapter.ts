/**
 * Tour plan (TP) items: a one-day or from-to plan with the DCR's day fields (Work on, band,
 * territories, Work With, SFC routes, meeting/office details), sent for approval, and once approved
 * offered on the DCR screen as a prefilled draft per day.
 *
 * Existing API (reused where it fits): monthly TourPlan with days[].entries[] (TourPlanEntry:
 * workTypeId, territoryIds, jointWorkUserIds) and per-dates submissions approved through
 * /v1/approvals (subjectType 'tour_plan'). It has no SFC route choice, no meeting/office details,
 * and no from-to item, so this feature targets a NEW item API (proposed below) and runs on a
 * device-local mock until CONTRACT.tpItems is true.
 *
 * Proposed contract for Architect:
 *   TourPlanItem { id, userId, userName, from: DateOnly, to: DateOnly (<= from + 30),
 *     status: 'draft'|'pending'|'approved'|'rejected', rejectionReason: string|null,
 *     plan: { workTypeId, territoryIds[], workWithUserIds[], sfcRoutes[{hqTerritoryId, sfcRouteId}],
 *             details: DcrDetails|null (meeting/training/office; never leave) },
 *     filedDates: DateOnly[] (days with a counted DCR), version, createdAt, updatedAt,
 *     submittedAt, decidedAt, decidedBy }
 *   GET    /v1/tour-plans/items?mine=true[&status=]           my items, newest first
 *   GET    /v1/tour-plans/items?status=pending                 team queue (approvals:decide, never own)
 *   GET    /v1/tour-plans/items/:id
 *   PUT    /v1/tour-plans/items          { id?, version?, from, to, plan }  -> draft (draft|rejected only)
 *   POST   /v1/tour-plans/items/:id/submit                     -> pending
 *   POST   /v1/tour-plans/items/:id/decision { decision, comment (1-500, required to reject) }
 *   DELETE /v1/tour-plans/items/:id                            draft/rejected only
 *   PUT /v1/dcrs/draft gains tourPlanItemId?: Id; a DCR filed from an approved item never needs a
 *     deviation reason, and the DCR date must lie in [from, to].
 */
import type { DcrDetails } from '@ariforce/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mockDeleteTp, mockGetTp, mockListTps, mockPutTp } from '@/mocks/tp';
import { apiFetch, idempotencyKey } from '../api';

export const CONTRACT = { tpItems: false } as const;

export type TpStatus = 'draft' | 'pending' | 'approved' | 'rejected';
export type TpPlan = {
  workTypeId: string;
  territoryIds: string[];
  workWithUserIds: string[];
  sfcRoutes: { hqTerritoryId: string; sfcRouteId: string }[];
  details: DcrDetails | null;
};
export type TpItem = {
  id: string;
  userId: string;
  userName: string;
  from: string;
  to: string;
  status: TpStatus;
  rejectionReason: string | null;
  plan: TpPlan;
  version: number;
  updatedAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
};

export const TP_LABEL: Record<TpStatus, string> = {
  draft: 'Draft',
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
};
export const TP_TONE = {
  draft: 'blue',
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
} as const satisfies Record<TpStatus, string>;
export const MAX_TP_DAYS = 31;

const SHORT_MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const parts = (d: string) => d.split('-').map(Number) as [number, number, number];

/** '3 Nov' or '3-5 Nov' or '30 Nov-2 Dec'. */
export function rangeLabel(from: string, to: string) {
  const [, fm, fd] = parts(from);
  const [, tm, td] = parts(to);
  if (from === to) return `${fd} ${SHORT_MONTHS[fm - 1]}`;
  if (fm === tm) return `${fd}-${td} ${SHORT_MONTHS[tm - 1]}`;
  return `${fd} ${SHORT_MONTHS[fm - 1]}-${td} ${SHORT_MONTHS[tm - 1]}`;
}

/** Every date from..to inclusive (YYYY-MM-DD, calendar arithmetic in UTC). */
export function datesOf(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length <= MAX_TP_DAYS) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const key = ['tp'] as const;

export function useMyTps(myId: string | undefined) {
  return useQuery({
    queryKey: [...key, 'mine', myId],
    enabled: !!myId,
    queryFn: async ({ signal }) => {
      if (CONTRACT.tpItems)
        return apiFetch<{ items: TpItem[] }>('/v1/tour-plans/items', {
          signal,
          query: { mine: 'true', limit: 100 },
        }).then((r) => r.items);
      // TODO: switch to the real endpoint (GET /v1/tour-plans/items?mine=true).
      const all = await mockListTps();
      return all
        .filter((t) => t.userId === myId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
  });
}

export function useTp(id: string | undefined) {
  return useQuery({
    queryKey: [...key, 'one', id],
    enabled: !!id,
    queryFn: async ({ signal }) => {
      if (CONTRACT.tpItems) return apiFetch<TpItem>(`/v1/tour-plans/items/${id}`, { signal });
      const t = await mockGetTp(id!);
      if (!t) throw new Error('This tour plan no longer exists.');
      return t;
    },
  });
}

/** Team TPs waiting for my decision (never my own). */
export function useTpQueue(myId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...key, 'queue', myId],
    enabled: enabled && !!myId,
    queryFn: async ({ signal }) => {
      if (CONTRACT.tpItems)
        return apiFetch<{ items: TpItem[] }>('/v1/tour-plans/items', {
          signal,
          query: { status: 'pending', limit: 100 },
        }).then((r) => r.items.filter((t) => t.userId !== myId));
      const all = await mockListTps();
      return all
        .filter((t) => t.status === 'pending' && t.userId !== myId)
        .sort((a, b) => a.from.localeCompare(b.from));
    },
  });
}

export type TpSaveInput = {
  id?: string;
  version?: number;
  from: string;
  to: string;
  plan: TpPlan;
  user: { id: string; name: string };
};

async function saveTp(b: TpSaveInput): Promise<TpItem> {
  if (CONTRACT.tpItems)
    return apiFetch<TpItem>('/v1/tour-plans/items', {
      method: 'PUT',
      body: { id: b.id, version: b.version, from: b.from, to: b.to, plan: b.plan },
    });
  const prev = b.id ? await mockGetTp(b.id) : null;
  if (prev && prev.status !== 'draft' && prev.status !== 'rejected')
    throw new Error('Only a draft or rejected tour plan can be changed.');
  const now = new Date().toISOString();
  return mockPutTp({
    id: prev?.id ?? idempotencyKey(),
    userId: b.user.id,
    userName: b.user.name,
    from: b.from,
    to: b.to,
    status: 'draft',
    rejectionReason: null,
    plan: b.plan,
    version: (prev?.version ?? 0) + 1,
    updatedAt: now,
    submittedAt: null,
    decidedAt: null,
  });
}

export function useSaveTp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, send }: { input: TpSaveInput; send: boolean }) => {
      const saved = await saveTp(input);
      if (!send) return saved;
      if (CONTRACT.tpItems)
        return apiFetch<TpItem>(`/v1/tour-plans/items/${saved.id}/submit`, { method: 'POST' });
      return mockPutTp({ ...saved, status: 'pending', submittedAt: new Date().toISOString() });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteTp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      CONTRACT.tpItems
        ? apiFetch<void>(`/v1/tour-plans/items/${id}`, { method: 'DELETE' })
        : mockDeleteTp(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDecideTp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      decision,
      reason,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      reason: string | null;
    }) => {
      if (CONTRACT.tpItems)
        return apiFetch<TpItem>(`/v1/tour-plans/items/${id}/decision`, {
          method: 'POST',
          body: { decision, ...(reason ? { comment: reason.slice(0, 500) } : {}) },
        });
      const t = await mockGetTp(id);
      if (!t || t.status !== 'pending')
        throw new Error('This tour plan is no longer waiting for approval.');
      return mockPutTp({
        ...t,
        status: decision === 'approve' ? 'approved' : 'rejected',
        rejectionReason: decision === 'reject' ? reason : null,
        decidedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}
