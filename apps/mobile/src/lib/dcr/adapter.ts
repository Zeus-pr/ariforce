/**
 * DCR contract adapter: the ONE place that knows which fields and endpoints the API has today and
 * which are still mocked (src/mocks/dcr.ts). Screens use only the types and hooks below.
 *
 * Waiting on Architect (packages/contracts + apps/api). When a piece lands, flip its flag here and
 * delete the mock branch; nothing else in the app changes.
 *   CONTRACT.productImageUrl     Product.imageUrl: string | null (GET /v1/products)
 *   CONTRACT.presentationFlag    DcrCall.presentationOpenedAt: Timestamp | null (read) and
 *                                DcrCallInput.presentationOpenedAt (PUT /v1/dcrs/draft)
 *   CONTRACT.reviewStatus        Dcr.status adds 'approved' | 'rejected'; Dcr.rejectionReason;
 *                                GET /v1/dcrs?status=approved|rejected; a rejected day may be filed again
 *                                (options.submitted ignores rejected; no DAY_ALREADY_SUBMITTED)
 *   CONTRACT.decisionEndpoint    POST /v1/dcrs/:id/decision { decision: 'approve'|'reject', comment }
 *                                (comment required to reject, like ApprovalDecision)
 * Already real: Product.pts (GET /v1/products), DcrCall.pob[] { productId, quantity }.
 */
import type { Dcr, DcrCall, Product } from '@ariforce/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  mockDecide,
  mockLoadDecisions,
  mockLoadPresentation,
  mockProductImageUrl,
  mockSavePresentation,
  type MockDecision,
} from '@/mocks/dcr';
import { apiFetch } from '../api';

/** TODO: switch each flag to true when the real contract field / endpoint ships. */
export const CONTRACT = {
  productImageUrl: false,
  presentationFlag: false,
  reviewStatus: false,
  decisionEndpoint: false,
} as const;

// ---------------------------------------------------------------- products

export type ProductOpt = {
  id: string;
  /** Brand name: the only thing a doctor call shows. */
  label: string;
  composition: string | null;
  packSize: string | null;
  /** Price to stockist, INR; null = price not set (counts as ₹0 in totals). */
  pts: number | null;
  imageUrl: string | null;
};

type ProductWire = Pick<Product, 'id' | 'name' | 'code' | 'composition' | 'packSize' | 'active'> & {
  pts?: number | null;
  imageUrl?: string | null;
};

export function toProductOpt(p: ProductWire): ProductOpt {
  return {
    id: p.id,
    label: p.name,
    composition: p.composition ?? null,
    packSize: p.packSize ?? null,
    pts: typeof p.pts === 'number' ? p.pts : null,
    imageUrl: CONTRACT.productImageUrl
      ? (p.imageUrl ?? null)
      : // TODO: switch to the real contract field (Product.imageUrl).
        mockProductImageUrl(p),
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
      return r.items.filter((p) => p.active).map(toProductOpt);
    },
  });
}

/** POB line value at PTS. The server's PobLine.value is PTR-based, so it is not used here. */
export const lineValue = (pts: number | null, qty: number) => (pts ?? 0) * qty;

// ---------------------------------------------------------------- presentation flag

/** Was the presentation opened on this saved doctor call (real field once it ships). */
export function callPresentationOpened(c: DcrCall): boolean | undefined {
  if (!CONTRACT.presentationFlag) return undefined;
  return !!(c as DcrCall & { presentationOpenedAt?: string | null }).presentationOpenedAt;
}

/** Extra fields for a call in PUT /v1/dcrs/draft. */
export function presentationInput(opened: boolean): Record<string, unknown> {
  if (!CONTRACT.presentationFlag) return {}; // TODO: switch to the real contract field.
  return { presentationOpenedAt: opened ? new Date().toISOString() : null };
}

/**
 * Doctors (outletIds) whose presentation was opened on `date`. Mock: kept on the device until
 * DcrCall.presentationOpenedAt lands; then this only seeds from the saved calls.
 */
export function usePresentationLog(date: string) {
  const [opened, setOpened] = useState<string[]>([]);
  const [ready, setReady] = useState<boolean>(CONTRACT.presentationFlag);
  useEffect(() => {
    if (CONTRACT.presentationFlag || !date) return;
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
        if (!CONTRACT.presentationFlag) void mockSavePresentation(date, next);
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
  const wire = d as unknown as { status: string; rejectionReason?: string | null };
  if (wire.status === 'approved' || wire.status === 'rejected')
    return { status: wire.status as 'approved' | 'rejected', reason: wire.rejectionReason ?? null };
  // TODO: switch to the real contract fields (Dcr.status approved/rejected, Dcr.rejectionReason).
  const m = !CONTRACT.reviewStatus ? decisions[d.id] : undefined;
  if (m && (d.status === 'submitted' || d.status === 'locked'))
    return { status: m.status, reason: m.reason };
  return { status: d.status, reason: null };
}

/** Rejected reports never count (days filed, calls, POB) and never block filing the day again. */
export const counts = (r: Review) => r.status !== 'rejected' && r.status !== 'draft';

const decisionsKey = ['dcr', 'decisions'] as const;

/** Decisions known on this device (mock store); empty once CONTRACT.reviewStatus is true. */
export function useDecisions() {
  return useQuery({
    queryKey: decisionsKey,
    enabled: !CONTRACT.reviewStatus,
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
      if (CONTRACT.decisionEndpoint)
        return apiFetch<Dcr>(`/v1/dcrs/${id}/decision`, {
          method: 'POST',
          body: { decision, ...(reason ? { comment: reason } : {}) },
        });
      // TODO: switch to the real endpoint (POST /v1/dcrs/:id/decision).
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

/** 12:01 AM IST on the day after `date` (the company default; the server's lockAt wins). */
export function defaultLockAt(date: string) {
  const d = new Date(`${date}T00:01:00+05:30`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Locked: past the lock time (server lockAt, else 12:01 AM IST next day) and not reopened. */
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['approvals', 'dcr_unlock'] }),
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
