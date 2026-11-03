/**
 * Live DCR API hooks (web dcr-workspace + dcr-flow). Same endpoints and query shapes.
 */
import type { Dcr } from '@ariforce/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiError, apiFetch, idempotencyKey } from '../api';
import type { ExpenseAutoDraft } from '../expenses';
import { noteOptions, type OptionsV2 } from './adapter';
import { monthStartIST, todayIST } from './dates';
import type { CallKind, HqOption, Person, WorkTypeOption } from './model';
import { draftBody, type FlowState } from './model';

export type Page<T> = { items: T[]; nextCursor?: string | null; total?: number | null };

export type DcrOptions = {
  date: string;
  workTypes: WorkTypeOption[];
  dcr?: Dcr | null;
  drafts?: Dcr[];
  submitted?: Dcr | null;
  /** From lockInfo — set even when `dcr` is null (approved unlock with no draft yet). */
  lockAt?: string;
  unlockedUntil?: string | null;
  locked?: boolean;
} & OptionsV2;

export type { ProductOpt } from './adapter';

const dcrKey = ['dcr'] as const;

export function useDraftList() {
  return useQuery({
    queryKey: [...dcrKey, 'drafts'],
    queryFn: ({ signal }) =>
      apiFetch<Page<Dcr>>('/v1/dcrs', {
        signal,
        query: { mine: 'true', status: 'draft', sort: '-updatedAt', limit: 50 },
      }),
  });
}

/** Submitted history for the current IST month (and earlier drafts' dates if needed). */
export function useSubmittedHistory(from = monthStartIST(), to = todayIST()) {
  return useQuery({
    queryKey: [...dcrKey, 'submitted', from, to],
    queryFn: ({ signal }) =>
      apiFetch<Page<Dcr>>('/v1/dcrs', {
        signal,
        // No status filter: submitted, locked, approved and rejected (drafts are dropped on screen).
        query: { mine: 'true', from, to, sort: '-date', limit: 100 },
      }),
  });
}

export function useDcrOptions(date: string) {
  return useQuery({
    queryKey: [...dcrKey, 'options', date],
    enabled: !!date,
    // Unlock can be approved on web while the form stays mounted — keep this fresh.
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const o = await apiFetch<DcrOptions>('/v1/dcrs/options', { signal, query: { date } });
      noteOptions(o);
      return o;
    },
  });
}

export function useDcrRecord(id: string | undefined) {
  return useQuery({
    queryKey: [...dcrKey, 'one', id],
    enabled: !!id,
    queryFn: ({ signal }) => apiFetch<Dcr>(`/v1/dcrs/${id}`, { signal }),
  });
}

export function useDcrTerritories(enabled: boolean) {
  return useQuery({
    queryKey: [...dcrKey, 'territories'],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: ({ signal }) =>
      apiFetch<{ items: HqOption[] }>('/v1/dcrs/territories', { signal }).then((r) => r.items),
  });
}

export function useWorkWith(enabled: boolean, q: string) {
  return useQuery({
    queryKey: [...dcrKey, 'work-with', q],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch<{ items: Person[] }>('/v1/dcrs/work-with', {
        signal,
        query: { limit: 50, q: q.trim() || undefined },
      }).then((r) => r.items),
  });
}

export type SfcMatchResult =
  | { ok: true; band: string | null; hqs: import('./model').SfcHq[] }
  | { ok: false; code: 'SFC_NO_MATCH'; missingHqIds: string[]; hqs: import('./model').SfcHq[] }
  | { ok: false; code: string };

export async function fetchSfcMatch(date: string, workTypeId: string, territoryIds: string[]) {
  try {
    const r = await apiFetch<{ band: string | null; hqs: import('./model').SfcHq[] }>(
      '/v1/dcrs/sfc-match',
      { query: { date, workTypeId, territoryIds: territoryIds.join(',') } },
    );
    return { ok: true as const, band: r.band, hqs: r.hqs };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'SFC_NO_MATCH') {
      const det = e.details as
        { missingHqIds?: string[]; hqs?: import('./model').SfcHq[] } | undefined;
      return {
        ok: false as const,
        code: 'SFC_NO_MATCH' as const,
        missingHqIds: det?.missingHqIds ?? [],
        hqs: det?.hqs ?? [],
      };
    }
    return { ok: false as const, code: e instanceof ApiError ? (e.code ?? 'ERROR') : 'ERROR' };
  }
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      state,
      saved,
    }: {
      state: FlowState;
      saved?: { id: string; version: number } | null;
    }) => apiFetch<Dcr>('/v1/dcrs/draft', { method: 'PUT', body: draftBody(state, saved) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dcrKey });
    },
  });
}

export function useSubmitDcr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, key }: { id: string; version: number; key: string }) =>
      apiFetch<Dcr & { expenseDraft?: ExpenseAutoDraft | null }>(`/v1/dcrs/${id}/submit`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: { version },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dcrKey });
      void qc.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/v1/dcrs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dcrKey });
    },
  });
}

export { idempotencyKey };

/** Where a call's customers come from: an HQ, narrowed to the picked territories under it. */
export type CustomerScope = { hqId: string; localIds: string[] };

export type CustomerRow = {
  id: string;
  name: string;
  city?: string | null;
  territoryId?: string | null;
  localTerritoryId?: string | null;
  approvalStatus?: string;
};

type CustomerQuery = { territoryId: string; localTerritoryId?: string };

const CUSTOMER_PATH: Record<CallKind, string> = {
  doctor: '/v1/doctors',
  chemist: '/v1/chemists',
  stockist: '/v1/stockists',
};

/**
 * Customers of the day's territories (web dcr-sections useCustomers): server search `q`, one query
 * per HQ (doctors and chemists narrowed by localTerritoryId to the picked territories; stockists
 * are not linked to territories, so the whole HQ). Each query pages with its own cursor; the next
 * page fetches only the queries that still have one.
 */
export function useCustomers(kind: CallKind, scopes: CustomerScope[], q: string, enabled: boolean) {
  const queries: CustomerQuery[] = scopes.flatMap((sc) =>
    kind !== 'stockist' && sc.localIds.length
      ? sc.localIds.map((localTerritoryId) => ({ territoryId: sc.hqId, localTerritoryId }))
      : [{ territoryId: sc.hqId }],
  );
  return useInfiniteQuery({
    queryKey: [...dcrKey, 'customers', kind, queries, q.trim()],
    enabled: enabled && queries.length > 0,
    placeholderData: keepPreviousData,
    initialPageParam: queries.map(() => undefined) as (string | null | undefined)[],
    queryFn: async ({ pageParam, signal }) => {
      const pages = await Promise.all(
        queries.map((query, i) =>
          pageParam[i] === null
            ? Promise.resolve({ items: [] as CustomerRow[], nextCursor: null })
            : apiFetch<Page<CustomerRow>>(CUSTOMER_PATH[kind], {
                signal,
                query: {
                  limit: 50,
                  sort: 'name',
                  q: q.trim() || undefined,
                  cursor: pageParam[i] ?? undefined,
                  ...query,
                },
              }),
        ),
      );
      return {
        items: pages.flatMap((p) => p.items),
        cursors: pages.map((p) => p.nextCursor ?? null),
      };
    },
    getNextPageParam: (last) => (last.cursors.some(Boolean) ? last.cursors : undefined),
  });
}
