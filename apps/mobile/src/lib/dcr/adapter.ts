/**
 * DCR contract adapter: the ONE place that knows the DCR contract (feat/dcr-pob-review @ d91a5e1)
 * and how to fall back while the live API is still the old one.
 *
 * Target contract (mirrored locally below; packages/contracts on this branch is still the old one):
 *   GET  /v1/dcrs/options       + rejected[], products[] (DcrProductOption), unlockRequest
 *   DcrCall.presentationOpenedAt (submit: 422 VALIDATION reason PRESENTATION_NOT_OPENED)
 *   DcrCall.calledAt            server-set, read-only: never sent by the app on the new API
 *   PobLine                     chemist/stockist only (422 reason POB_NOT_ALLOWED_FOR_DOCTOR), value at PTS
 *   Dcr.status                  + approved | rejected; reviewStatus, rejectionReason, unlockedUntil (48 h)
 *   POST /v1/dcrs/:id/decision  { decision, comment (1-500, required to reject) }
 *   Lock                        00:00 IST the next day
 *
 * Fallbacks (until the API is live), feature-detected at runtime, never by a build flag:
 *   - apiCaps.v2 turns on when /v1/dcrs/options carries `products` + `unlockRequest`.
 *   - Old API: products from GET /v1/products with mock images; presentation flag kept on the device;
 *     calledAt still sent; review status from the device-local decision store; the decision endpoint
 *     falls back to that store when the route does not exist (404 without an API error code).
 */
import type { Dcr, DcrCall, Product } from '@ariforce/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  mockDecide,
  mockLoadDecisions,
  mockLoadPresentation,
  mockProductImageUrl,
  mockSavePresentation,
  type MockDecision,
} from '@/mocks/dcr';
import { ApiError, apiFetch } from '../api';
import { productDisplayName } from '../product-name';
import { byName, sortByLabel } from '../sort';

/** The app targets the new contract; each flag still falls back at runtime (see above). */
export const CONTRACT = {
  productImageUrl: true,
  presentationFlag: true,
  reviewStatus: true,
  decisionEndpoint: true,
} as const;

/** What the live API supports, learned from responses (module state; one API per app run). */
export const apiCaps = { v2: false, decisionRoute: true };

// ---- local mirror of the new contract (feat/dcr-pob-review d91a5e1) ----
export type DcrProductOption = {
  id: string;
  name: string;
  code?: string;
  brand?: string | null;
  composition: string | null;
  packSize: string | null;
  pts: number | null;
  imageUrl?: string | null;
  active?: boolean;
};
export type UnlockState = {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedAt: string;
};
/** options.detailProducts[] (contracts c44b325 DcrDetailProduct): server-grouped doctor picker. */
export type DcrDetailProduct = {
  displayName: string;
  productId: string;
  productIds: string[];
  composition: string | null;
  imageUrl: string | null;
};
export type OptionsV2 = {
  detailProducts?: DcrDetailProduct[];
  rejected?: Dcr[];
  products?: DcrProductOption[];
  unlockRequest?: UnlockState | null;
};
type CallWire = { presentationOpenedAt?: string | null };
type DcrWire = {
  status: string;
  reviewStatus?: 'pending' | 'approved' | 'rejected' | null;
  rejectionReason?: string | null;
};

/** Call on every /v1/dcrs/options response. */
export function noteOptions(o: unknown) {
  if (o && typeof o === 'object' && 'products' in o && 'unlockRequest' in o) apiCaps.v2 = true;
}

// ---------------------------------------------------------------- products

export type ProductOpt = {
  id: string;
  /** Brand name: the only thing a doctor call shows. */
  label: string;
  /** Brand (e.g. "Ariclav" for "Ariclav 625"); null when the API has none. */
  brand: string | null;
  composition: string | null;
  packSize: string | null;
  /** Price to stockist, INR; null = price not set (counts as ₹0 in totals). */
  pts: number | null;
  imageUrl: string | null;
};

type ProductWire = Pick<Product, 'id' | 'name' | 'composition' | 'packSize'> & {
  brand?: string | null;
  code?: string;
  active?: boolean;
  pts?: number | null;
  imageUrl?: string | null;
};

export function toProductOpt(p: ProductWire): ProductOpt {
  return {
    id: p.id,
    label: p.name,
    brand: p.brand?.trim() || null,
    composition: p.composition ?? null,
    packSize: p.packSize ?? null,
    pts: typeof p.pts === 'number' ? p.pts : null,
    // Real field when the API sends it (even null = no picture); mock only on the old API.
    imageUrl: 'imageUrl' in p ? (p.imageUrl ?? null) : mockProductImageUrl(p),
  };
}

export function useProductCatalog(enabled: boolean) {
  return useQuery({
    queryKey: ['dcr', 'products'],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const r = await apiFetch<{ items: ProductWire[] }>('/v1/products', {
        signal,
        query: { limit: 200 },
      });
      return sortByLabel(r.items.filter((p) => p.active !== false).map(toProductOpt));
    },
  });
}

/**
 * Picker products: options.products (new API), else the GET /v1/products fallback. A-Z by name.
 */
export function useDcrProducts(options: OptionsV2 | undefined, enabled: boolean) {
  const fromOptions = options?.products?.length ? options.products : null;
  const fallback = useProductCatalog(enabled && !!options && !fromOptions);
  return useMemo(
    () => ({
      data: fromOptions ? sortByLabel(fromOptions.map(toProductOpt)) : (fallback.data ?? []),
      detail: options?.detailProducts?.length ? options.detailProducts : null,
      isPending: !fromOptions && fallback.isPending,
    }),
    [fromOptions, fallback.data, fallback.isPending, options?.detailProducts],
  );
}

/**
 * What a doctor call shows for a product (picker, picked list, presentation): the brand when set,
 * else the full name. Products sharing a brand are NOT merged. Chemist/stockist keep `label`.
 */
/** Doctor-call label: the API's displayName rule (lib/product-name.ts, from contracts c44b325). */
export function doctorProductLabel(p: Pick<ProductOpt, 'label'> & { displayName?: string | null }) {
  return p.displayName || productDisplayName(p.label);
}

export type BrandGroup = { key: string; label: string; repId: string; ids: string[] };

/**
 * Doctor picker groups: one row per doctorProductLabel (case-insensitive), A-Z. The row stands for
 * a real product (`repId`, valid for productsDetailed): the first SKU by name that has an image,
 * else the first by name.
 */
export function brandGroups(
  products: readonly ProductOpt[],
  detail?: readonly DcrDetailProduct[] | null,
): BrandGroup[] {
  // Prefer the server's grouping when the API sends it.
  if (detail?.length)
    return detail
      .map((d) => ({
        key: d.displayName.toLocaleLowerCase(),
        label: d.displayName,
        repId: d.productId,
        ids: d.productIds,
      }))
      .sort((a, b) => byName(a.label, b.label));
  const m = new Map<string, ProductOpt[]>();
  for (const p of products) {
    const key = doctorProductLabel(p).trim().toLocaleLowerCase();
    m.set(key, [...(m.get(key) ?? []), p]);
  }
  return [...m.entries()]
    .map(([key, ps]) => {
      const sorted = [...ps].sort((a, b) => byName(a.label, b.label));
      const rep = sorted.find((p) => p.imageUrl) ?? sorted[0]!;
      return { key, label: doctorProductLabel(rep), repId: rep.id, ids: sorted.map((p) => p.id) };
    })
    .sort((a, b) => byName(a.label, b.label));
}

/** POB line value at PTS. The server's PobLine.value is PTR-based, so it is not used here. */
export const lineValue = (pts: number | null, qty: number) => (pts ?? 0) * qty;

// ---------------------------------------------------------------- presentation flag

/** Was the presentation opened on this saved doctor call (real field once it ships). */
export function callPresentationOpened(c: DcrCall): boolean | undefined {
  const w = c as DcrCall & CallWire;
  return 'presentationOpenedAt' in w ? !!w.presentationOpenedAt : undefined;
}

/** Extra fields for a call in PUT /v1/dcrs/draft. */
export function presentationInput(opened: boolean, at?: string | null): Record<string, unknown> {
  if (!apiCaps.v2) return {}; // old API: the flag lives on the device (usePresentationLog)
  return { presentationOpenedAt: opened ? (at ?? new Date().toISOString()) : null };
}

/** Call fields for PUT /v1/dcrs/draft: calledAt is server-set on the new API, so never sent. */
export const sendsCalledAt = () => !apiCaps.v2;

/**
 * Doctors (outletIds) whose presentation was opened on `date`. Mock: kept on the device until
 * DcrCall.presentationOpenedAt lands; then this only seeds from the saved calls.
 */
export function usePresentationLog(date: string) {
  const [opened, setOpened] = useState<string[]>([]);
  // Device log kept as a fallback even on the new API: it only ever adds "opened".
  const [ready, setReady] = useState<boolean>(false);
  useEffect(() => {
    if (!date) return;
    let live = true;
    setReady(false);
    void mockLoadPresentation(date).then((ids) => {
      if (!live) return;
      setOpened(ids);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [date]);
  const record = useCallback(
    (outletId: string) => {
      setOpened((xs) => {
        const next = xs.includes(outletId) ? xs : [...xs, outletId];
        void mockSavePresentation(date, next);
        return next;
      });
    },
    [date],
  );
  return { opened, ready, record };
}

// ---------------------------------------------------------------- review status

export type ReviewStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'locked';
export type Review = { status: ReviewStatus; reason: string | null };

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  locked: 'Locked',
};
export const REVIEW_TONE = {
  draft: 'blue',
  submitted: 'teal',
  approved: 'green',
  rejected: 'red',
  locked: 'neutral',
} as const satisfies Record<ReviewStatus, string>;

export function reviewOf(d: Dcr, decisions: Record<string, MockDecision> = {}): Review {
  const wire = d as unknown as DcrWire;
  if (wire.status === 'approved' || wire.status === 'rejected')
    return { status: wire.status, reason: wire.rejectionReason ?? null };
  if (wire.reviewStatus === 'approved' || wire.reviewStatus === 'rejected')
    return { status: wire.reviewStatus, reason: wire.rejectionReason ?? null };
  // Old API (no reviewStatus field): the device-local decision store.
  const m = !('reviewStatus' in wire) ? decisions[d.id] : undefined;
  if (m && (d.status === 'submitted' || d.status === 'locked'))
    return { status: m.status, reason: m.reason };
  return { status: d.status, reason: null };
}

/** Rejected reports never count (days filed, calls, POB) and never block filing the day again. */
export const counts = (r: Review) => r.status !== 'rejected' && r.status !== 'draft';

const decisionsKey = ['dcr', 'decisions'] as const;

const isApiCode = (c: string | undefined) => !!c && /^[A-Z_]+$/.test(c) && c !== 'HTTP_404';

/** Plain words for POST /v1/dcrs/:id/decision errors. */
export function decisionErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409 || e.code === 'NOT_PENDING_REVIEW')
      return 'This DCR is no longer waiting for review. Someone may have decided it already, or it was changed. Pull to refresh.';
    if (e.status === 403) return 'You can’t review your own DCR.';
    if (e.status === 404) return 'This DCR isn’t in your team, or it was deleted.';
    if (e.status === 422) return 'Give a reason to reject (1 to 500 characters).';
    if (e.code === 'NETWORK') return 'No connection. Check your network and try again.';
    return e.message || 'Could not save the decision. Try again.';
  }
  return 'Could not save the decision. Try again.';
}

/** Decisions known on this device (old-API fallback; ignored for DCRs that carry reviewStatus). */
export function useDecisions() {
  return useQuery({
    queryKey: decisionsKey,
    enabled: true,
    staleTime: 0,
    queryFn: () => mockLoadDecisions(),
  });
}

export function useDecideDcr() {
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
      if (apiCaps.decisionRoute) {
        try {
          return await apiFetch<Dcr>(`/v1/dcrs/${id}/decision`, {
            method: 'POST',
            body: { decision, ...(reason ? { comment: reason.slice(0, 500) } : {}) },
          });
        } catch (e) {
          // Route not deployed yet: Nest's own 404 has no API error code. A real "outside your
          // team" 404 carries NOT_FOUND and is shown to the manager.
          if (!(e instanceof ApiError && e.status === 404 && !isApiCode(e.code))) throw e;
          apiCaps.decisionRoute = false;
        }
      }
      return mockDecide(id, decision, reason);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dcr'] });
    },
  });
}

// ---------------------------------------------------------------- manager review

/** The team's submitted DCRs (GET /v1/dcrs is already scoped to the caller's reporting line). */
export function useTeamSubmitted(myId: string | undefined) {
  return useQuery({
    queryKey: ['dcr', 'team', 'submitted', myId],
    enabled: !!myId,
    queryFn: async ({ signal }) => {
      const r = await apiFetch<{ items: Dcr[] }>('/v1/dcrs', {
        signal,
        query: { status: 'submitted', sort: '-date', limit: 100 },
      });
      return r.items.filter((d) => d.userId !== myId);
    },
  });
}

/** id → name for everyone in GET /v1/team (a tree; read defensively). */
export function useTeamNames(enabled: boolean) {
  return useQuery({
    queryKey: ['team', 'names'],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const tree = await apiFetch<unknown>('/v1/team', { signal });
      const names = new Map<string, string>();
      const walk = (v: unknown, depth: number) => {
        if (depth > 12 || !v || typeof v !== 'object') return;
        if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
        const o = v as Record<string, unknown>;
        if (typeof o.id === 'string' && typeof o.name === 'string') names.set(o.id, o.name);
        for (const x of Object.values(o)) if (x && typeof x === 'object') walk(x, depth + 1);
      };
      walk(tree, 0);
      return names;
    },
  });
}

// ---------------------------------------------------------------- day lock + unlock requests
// Real today: Dcr.lockAt / Dcr.unlockedUntil / status 'locked', POST /v1/dcrs/correction-requests
// { date, reason } (DcrCorrectionRequest), and the dcr_unlock approvals in GET /v1/approvals with
// POST /v1/approvals/:id/decision (ApprovalDecision). No mock needed.

/** 00:00 IST on the day after `date` (submit by 23:59 IST); the server's lockAt wins. */
export function defaultLockAt(date: string) {
  const d = new Date(`${date}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Locked: past the lock time (server lockAt, else 00:00 IST next day) and not reopened. */
export function isDayLocked(dcr: Dcr | null, date: string, now = new Date()) {
  if (dcr?.unlockedUntil && new Date(dcr.unlockedUntil) > now) return false;
  if (dcr?.status === 'locked') return true;
  const lockAt = dcr?.lockAt ? new Date(dcr.lockAt) : defaultLockAt(date);
  return now >= lockAt;
}

export type UnlockRequest = {
  id: string;
  subjectId: string;
  requestedBy: string;
  requestedByName: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  summary: string;
  comment: string | null;
  createdAt: string;
  rejectionReason?: string | null;
};

export function useRequestUnlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { date: string; reason: string }) =>
      apiFetch<UnlockRequest>('/v1/dcrs/correction-requests', { method: 'POST', body: b }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals', 'dcr_unlock'] });
      void qc.invalidateQueries({ queryKey: ['dcr', 'options'] });
    },
  });
}

/** My pending unlock requests (to show "Unlock requested" instead of the button). */
export function useMyUnlockRequests(enabled: boolean) {
  return useQuery({
    queryKey: ['approvals', 'dcr_unlock', 'mine'],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch<{ items: UnlockRequest[] }>('/v1/approvals', {
        signal,
        query: { mine: 'requested', subjectType: 'dcr_unlock', status: 'pending', limit: 50 },
      }).then((r) => r.items),
  });
}

/** Unlock requests from my reporting line waiting for my decision. */
export function useUnlockQueue(enabled: boolean) {
  return useQuery({
    queryKey: ['approvals', 'dcr_unlock', 'to_decide'],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch<{ items: UnlockRequest[] }>('/v1/approvals', {
        signal,
        query: { mine: 'to_decide', subjectType: 'dcr_unlock', status: 'pending', limit: 100 },
      }).then((r) => r.items),
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      decision: 'approve' | 'reject';
      comment?: string;
    }) =>
      apiFetch<UnlockRequest>(`/v1/approvals/${id}/decision`, {
        method: 'POST',
        body: { decision, ...(comment ? { comment } : {}) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['dcr'] });
    },
  });
}

// ---------------------------------------------------------------- submit rule errors (422)

const RULE_TEXT = {
  PRESENTATION_NOT_OPENED: {
    message: 'Open the presentation on every doctor call before submitting.',
    callText: 'Open the presentation for this call.',
  },
  POB_NOT_ALLOWED_FOR_DOCTOR: {
    message: 'Doctor calls can’t carry an order (POB). Remove it from the doctor call.',
    callText: 'Remove the order (POB) from this doctor call.',
  },
} as const;

/**
 * 422 VALIDATION with details.reason PRESENTATION_NOT_OPENED | POB_NOT_ALLOWED_FOR_DOCTOR and
 * callIds (= the call clientIds) / callIndexes (into the calls sent). Returns the offending clientIds.
 */
export function submitRuleError(e: unknown, sentClientIds: string[]) {
  if (!(e instanceof ApiError) || e.status !== 422) return null;
  const det = (e.details ?? {}) as {
    reason?: string;
    callIds?: string[];
    callIndexes?: number[];
  };
  const reason = det.reason as keyof typeof RULE_TEXT | undefined;
  if (!reason || !(reason in RULE_TEXT)) return null;
  const byId = (det.callIds ?? []).filter((id) => sentClientIds.includes(id));
  const ids = byId.length
    ? byId
    : (det.callIndexes ?? []).map((i) => sentClientIds[i]).filter((x): x is string => !!x);
  return { reason, clientIds: ids, ...RULE_TEXT[reason] };
}
