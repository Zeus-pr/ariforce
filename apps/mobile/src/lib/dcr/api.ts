/**
 * Live DCR API hooks (web dcr-workspace + dcr-flow). Same endpoints and query shapes.
 */
import type { Dcr } from '@ariforce/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, idempotencyKey } from '../api';
import { monthStartIST, todayIST } from './dates';
import type { HqOption, Person, WorkTypeOption } from './model';
import { draftBody, type FlowState } from './model';

export type Page<T> = { items: T[]; nextCursor?: string | null; total?: number | null };

export type DcrOptions = {
  date: string;
  workTypes: WorkTypeOption[];
  dcr?: Dcr | null;
  drafts?: Dcr[];
  submitted?: Dcr | null;
};

export type ProductOpt = { id: string; label: string; hint?: string | null };

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
        query: { mine: 'true', status: 'submitted', from, to, sort: '-date', limit: 100 },
      }),
  });
}

export function useDcrOptions(date: string) {
  return useQuery({
    queryKey: [...dcrKey, 'options', date],
    enabled: !!date,
    queryFn: ({ signal }) =>
      apiFetch<DcrOptions>('/v1/dcrs/options', { signal, query: { date } }),
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

export function useProducts(enabled: boolean) {
  return useQuery({
    queryKey: [...dcrKey, 'products'],
    enabled,
    staleTime: 10 * 60_000,
    queryFn: async ({ signal }) => {
      const r = await apiFetch<Page<{ id: string; name: string; composition?: string | null; active: boolean }>>(
        '/v1/products',
        { signal, query: { limit: 200 } },
      );
      return r.items
        .filter((p) => p.active)
        .map((p): ProductOpt => ({ id: p.id, label: p.name, hint: p.composition }));
    },
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
      const det = e.details as { missingHqIds?: string[]; hqs?: import('./model').SfcHq[] } | undefined;
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
    mutationFn: async ({
      id,
      version,
      key,
    }: {
      id: string;
      version: number;
      key: string;
    }) =>
      apiFetch<Dcr>(`/v1/dcrs/${id}/submit`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: { version },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dcrKey });
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
