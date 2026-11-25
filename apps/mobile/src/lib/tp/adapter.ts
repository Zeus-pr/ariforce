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
 * Contract: feat/dcr-pob-review @ 28f8820 (packages/contracts/src/schemas/tp-items.ts), not live yet.
 * The app probes GET /v1/tour-plans/items once (tpCaps.live) and falls back to the mock on 404.
 *
 * Originally proposed contract (matches 28f8820):
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
import { ApiError, apiFetch, idempotencyKey } from '../api';
import { todayIST } from '../dcr/dates';
import { tpCaps } from './caps';

/**
 * CONTRACT.tpItems: true while the real API answers. Detected at runtime by isLive(); the mock
 * (src/mocks/tp.ts) stays as the fallback until the route is deployed.
 */
export const CONTRACT = {
  get tpItems() {
    return tpCaps.live === true;
  },
};

let probe: Promise<boolean> | null = null;
/** One probe per app run: 404 on the list route = not deployed (mock); other errors retry later. */
export function isLive(): Promise<boolean> {
  if (tpCaps.live != null) return Promise.resolve(tpCaps.live);
  probe ??= apiFetch('/v1/tour-plans/items', { query: { mine: 'true', limit: 1 } })
    .then(() => (tpCaps.live = true))
    .catch((e: unknown) => {
      probe = null;
      if (e instanceof ApiError && (e.status === 404 || e.status === 405))
        return (tpCaps.live = false);
      throw e;
    });
  return probe;
}

export type TpStatus = 'draft' | 'pending' | 'approved' | 'rejected';
type TpPlanCore = {
  workTypeId: string;
  territoryIds: string[];
  workWithUserIds: string[];
  sfcRoutes: { hqTerritoryId: string; sfcRouteId: string }[];
  details: DcrDetails | null;
};
/** Second plan on the same day. */
export type TpSection = TpPlanCore;
/** One day inside a month item. The month is still one approval. */
export type TpDayPlan = TpPlanCore & { date: string; sections?: TpSection[] };
export type TpPlan = TpPlanCore & {
  sections?: TpSection[];
  days?: TpDayPlan[];
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
  /** 28f8820 extras (absent in the mock). */
  companyId?: string;
  createdAt?: string;
  decidedBy?: string | null;
  filedDates?: string[];
  /** Fares of the stored routes, from the filer's chart. Absent until the API sends them. */
  routeFacts?: TpRouteFact[];
};

export type TpRouteFact = {
  id: string;
  hqTerritoryId: string;
  fromPlace: string;
  toPlace: string;
  oneWayKm: number;
  bothWayKm: number;
  oneWayAmount: number | null;
  bothWayAmount: number | null;
  actualFare: boolean;
  travelMode: string | null;
  category: string | null;
  da: number | null;
};

/** options.tourPlanDrafts[] (DcrTourPlanDraft = TourPlanItem + these dates). */
export type TpDraftCard = TpItem & {
  /** Unfiled days from today on; the card shows while non-empty. */
  pendingDates: string[];
  /** pendingDates that already have a DCR draft. */
  draftDates: string[];
  /** Days that can be submitted now (today only); future pending days take drafts only. */
  fileableDates: string[];
};

/** Mock twin of the server's tpItemCard(): past unfiled days are locked, so they are left out. */
export function mockTpCard(
  t: TpItem,
  filed: Set<string>,
  drafts: Set<string>,
  today: string,
): TpDraftCard | null {
  if (t.status !== 'approved') return null;
  const open = datesOf(t.from, t.to).filter((d) => !filed.has(d) && d >= today);
  if (!open.length) return null;
  return {
    ...t,
    pendingDates: open,
    draftDates: open.filter((d) => drafts.has(d)),
    fileableDates: open.filter((d) => d === today),
  };
}

const TP_ERRORS: Record<string, string> = {
  TP_IN_PAST: 'A tour plan must start today or later. Change the From date.',
  TP_OVERLAP: 'These dates overlap another tour plan that is pending or approved.',
  TP_LOCKED: 'This tour plan is pending or approved and can no longer be changed.',
  TP_CUTOFF: 'Tour plans are for the next month only.',
  VERSION_CONFLICT: 'This tour plan changed on another device. Go back and open it again.',
  REJECTION_REASON_REQUIRED: 'Give a reason to reject.',
  CONFLICT: 'This tour plan is no longer waiting for approval.',
  APPROVAL_NOT_YOUR_STEP: 'This tour plan is waiting for a different approver.',
};

const MONTH_NAMES =
  'January February March April May June July August September October November December'.split(
    ' ',
  );

/** YYYY-MM of the calendar month after `ym` (YYYY-MM). */
function nextYmOf(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  let ny = y!;
  let nm = m! + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/**
 * Tour plans are for the **next** calendar month only (never current, past, or later).
 * The month stays open through the last day of this month. After that it closes.
 * Returns an error string when not allowed; null when OK.
 */
export function tpFutureMonthCutoffError(from: string, _now = new Date()): string | null {
  const planYm = from.slice(0, 7);
  const currentYm = todayIST().slice(0, 7);
  const nextYm = nextYmOf(currentYm);
  const [py, pm] = planYm.split('-').map(Number);
  const planLabel = `${MONTH_NAMES[pm! - 1]} ${py}`;
  const [cy, cm] = currentYm.split('-').map(Number);
  const currLabel = `${MONTH_NAMES[cm! - 1]} ${cy}`;

  if (planYm <= currentYm)
    return `Tour plans are for the next month only — ${planLabel} is not open (current month is ${currLabel}).`;
  if (planYm !== nextYm)
    return `Only ${MONTH_NAMES[Number(nextYm.slice(5, 7)) - 1]} ${nextYm.slice(0, 4)} can be planned now.`;
  return null;
}

/** First day of the next month when the TP window is still open; otherwise null. */
export function tpDefaultFromDate(now = new Date()): string | null {
  const nextYm = nextYmOf(todayIST().slice(0, 7));
  const from = `${nextYm}-01`;
  return tpFutureMonthCutoffError(from, now) ? null : from;
}
/** Plain-language TP errors (28f8820 codes; leave/holiday work types come back as VALIDATION). */
export function tpMessage(e: unknown): string {
  if (!(e instanceof ApiError)) {
    const code = (e as { code?: string } | null)?.code;
    if (code && TP_ERRORS[code]) return TP_ERRORS[code]!;
    return (e as Error)?.message || 'Something went wrong.';
  }
  if (e.code && TP_ERRORS[e.code]) return TP_ERRORS[e.code]!;
  if (e.code === 'VALIDATION' && /leave/i.test(e.message))
    return 'Leave and holidays are not planned in a tour plan. Apply for leave instead.';
  if (
    e.code === 'VALIDATION' &&
    (e.details as { reason?: string })?.reason === 'TOUR_PLAN_ITEM_MISMATCH'
  )
    return 'This day is not part of an approved tour plan of yours.';
  if (e.code === 'NETWORK') return 'Could not reach the server.';
  return e.message || 'Something went wrong.';
}

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

export async function allTpItems(
  signal: AbortSignal,
  query: { mine?: 'true'; status?: string },
): Promise<TpItem[]> {
  const items: TpItem[] = [];
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < 50; pageNo++) {
    const page = await apiFetch<{ items: TpItem[]; nextCursor?: string | null }>(
      '/v1/tour-plans/items',
      { signal, query: { ...query, limit: 100, ...(cursor ? { cursor } : {}) } },
    );
    items.push(...(page.items ?? []));
    if (!page.nextCursor) return items;
    cursor = page.nextCursor;
  }
  return items;
}

export function useMyTps(myId: string | undefined) {
  return useQuery({
    queryKey: [...key, 'mine', myId],
    enabled: !!myId,
    queryFn: async ({ signal }) => {
      if (await isLive()) return allTpItems(signal, { mine: 'true' });
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
      if (await isLive()) return apiFetch<TpItem>(`/v1/tour-plans/items/${id}`, { signal });
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
      if (await isLive()) {
        const items = await allTpItems(signal, { status: 'pending' });
        return items.filter(
          (t) => t.userId !== myId && (t as { canDecide?: boolean }).canDecide !== false,
        );
      }
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
  const cutoff = tpFutureMonthCutoffError(b.from);
  if (cutoff) {
    const err = new Error(cutoff) as Error & { code?: string };
    err.code = 'TP_CUTOFF';
    throw err;
  }
  if (await isLive())
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
      if (await isLive())
        return apiFetch<TpItem>(`/v1/tour-plans/items/${saved.id}/submit`, { method: 'POST' });
      return mockPutTp({ ...saved, status: 'pending', submittedAt: new Date().toISOString() });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

/** One item for the whole month, then one submit. Day drafts are removed only after that succeeds. */
export async function submitMonthTourPlan(input: {
  from: string;
  to: string;
  plan: TpPlan;
  user: { id: string; name: string };
  draftIds: string[];
}): Promise<TpItem> {
  const saved = await saveTp({
    from: input.from,
    to: input.to,
    plan: input.plan,
    user: input.user,
  });
  try {
    const sent = (await isLive())
      ? await apiFetch<TpItem>(`/v1/tour-plans/items/${saved.id}/submit`, { method: 'POST' })
      : await mockPutTp({ ...saved, status: 'pending', submittedAt: new Date().toISOString() });
    for (const id of input.draftIds) {
      if (id === saved.id) continue;
      if (await isLive()) await apiFetch<void>(`/v1/tour-plans/items/${id}`, { method: 'DELETE' });
      else await mockDeleteTp(id);
    }
    return sent;
  } catch (e) {
    if (await isLive())
      await apiFetch<void>(`/v1/tour-plans/items/${saved.id}`, { method: 'DELETE' }).catch(
        () => undefined,
      );
    else await mockDeleteTp(saved.id);
    throw e;
  }
}

export function useSubmitMonthTp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitMonthTourPlan,
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
}

export function useDeleteTp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await isLive())
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
      if (await isLive())
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
