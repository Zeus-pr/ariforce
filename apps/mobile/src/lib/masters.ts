/**
 * Doctors, chemists and stockists: the website's master-data logic, ported for the app.
 *
 * Mirrors apps/web/src/components/masters/config.ts (fields, labels, required), source.ts
 * (GET /v1/{kind} with q, filters, cursor paging, deleted rows dropped), lookups.tsx
 * (territories paged through every cursor, specialties, doctor categories) and record-sheet.tsx
 * (create/PATCH with version/DELETE, doctor duplicate check, the same error words).
 *
 * Validation is the contract's zod rules (packages/contracts/src/schemas/masters.ts) written out
 * by hand: the app bundle never imports zod. Types come from the contract (type-only imports).
 */
import type {
  Chemist,
  Doctor,
  DoctorCategory,
  DoctorDuplicate,
  Specialty,
  Stockist,
  Territory,
} from '@ariforce/contracts';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError, apiFetch, idempotencyKey } from './api';

export type MasterKind = 'doctors' | 'chemists' | 'stockists';
export type MasterRow = Doctor | Chemist | Stockist;
export type Values = Record<string, string | null>;
export type { DoctorDuplicate };

export const MASTER_KINDS = ['doctors', 'chemists', 'stockists'] as const;
export const isMasterKind = (k: unknown): k is MasterKind =>
  typeof k === 'string' && (MASTER_KINDS as readonly string[]).includes(k);

export type FieldDef = {
  key: string;
  label: string;
  type: 'text' | 'territory' | 'specialty' | 'category' | 'tel' | 'pincode';
  required?: boolean;
  /** Contract max length (zod .max). */
  max?: number;
  placeholder?: string;
};

const address: FieldDef[] = [
  { key: 'phone', label: 'Phone', type: 'tel', max: 20 },
  { key: 'addressLine', label: 'Address', type: 'text', max: 300 },
  { key: 'city', label: 'City', type: 'text', max: 80 },
  { key: 'state', label: 'State', type: 'text', max: 80 },
  { key: 'pincode', label: 'PIN code', type: 'pincode' },
];

const trade: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', required: true, max: 160 },
  { key: 'territoryId', label: 'Territory', type: 'territory', required: true },
  { key: 'gstin', label: 'GSTIN', type: 'text', max: 15, placeholder: '19ABCDE1234F1Z5' },
  { key: 'drugLicenseNo', label: 'Drug licence no.', type: 'text', max: 60 },
  ...address,
];

export const MASTERS: Record<
  MasterKind,
  { title: string; singular: string; path: `/v1/${MasterKind}`; fields: FieldDef[] }
> = {
  doctors: {
    title: 'Doctors',
    singular: 'doctor',
    path: '/v1/doctors',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, max: 160 },
      { key: 'territoryId', label: 'Territory', type: 'territory', required: true },
      {
        key: 'qualification',
        label: 'Qualification',
        type: 'text',
        max: 120,
        placeholder: 'MBBS, MD',
      },
      { key: 'specialtyId', label: 'Specialty', type: 'specialty' },
      { key: 'categoryId', label: 'Category', type: 'category' },
      { key: 'registrationNo', label: 'Registration no.', type: 'text', max: 40 },
      ...address,
    ],
  },
  chemists: { title: 'Chemists', singular: 'chemist', path: '/v1/chemists', fields: trade },
  stockists: { title: 'Stockists', singular: 'stockist', path: '/v1/stockists', fields: trade },
};

/** Same filters as the website's table (source.ts FILTER_PARAMS). */
export const FILTERS: Record<MasterKind, ('territoryId' | 'specialtyId' | 'categoryId')[]> = {
  doctors: ['territoryId', 'specialtyId', 'categoryId'],
  chemists: ['territoryId'],
  stockists: ['territoryId'],
};

/** Same words as the website (pickers.tsx APPROVAL_LABEL). */
export const APPROVAL_LABEL: Record<string, string> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** 'No Doc' placeholder doctors (web masters/placeholder.tsx). */
export const isPlaceholderName = (name: string) => /^\s*no\s*\.?\s*doc(tor)?\b/i.test(name);

/** Empty create body: every nullable field present as null (web config.ts blankRecord). */
export function blankRecord(kind: MasterKind): Values {
  const out: Values = {};
  for (const f of MASTERS[kind].fields) out[f.key] = f.required ? '' : null;
  return out;
}

export function valuesFrom(kind: MasterKind, row: MasterRow | null): Values {
  const base = blankRecord(kind);
  if (row)
    for (const k of Object.keys(base))
      base[k] = ((row as Record<string, unknown>)[k] as string | null) ?? base[k]!;
  return base;
}

const PIN = /^[1-9][0-9]{5}$/;

/** Contract rules with the website's messages (record-sheet.tsx save()). */
export function validate(kind: MasterKind, values: Values): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of MASTERS[kind].fields) {
    const v = values[f.key];
    if (f.required && !String(v ?? '').trim()) errs[f.key] = 'Required.';
    else if (f.type === 'pincode' && v != null && !PIN.test(v))
      errs[f.key] = 'Use a 6-digit PIN code.';
    else if (f.max && v != null && v.length > f.max)
      errs[f.key] = `Too long: at most ${f.max} characters.`;
  }
  return errs;
}

export type Page<T> = { items: T[]; nextCursor: string | null; total?: number | null };

// ---------- lookups (web masters/lookups.tsx) ----------

export type Lookups = {
  territories: Territory[];
  specialties: Specialty[];
  categories: DoctorCategory[];
  byId: Map<string, string>;
  ready: boolean;
};

async function allTerritories() {
  const items: Territory[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await apiFetch<Page<Territory>>('/v1/territories', { query: { limit: 200, cursor } });
    items.push(...r.items);
    cursor = r.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return items;
}

export function useLookups(): Lookups {
  const q = useQuery({
    queryKey: ['lookups'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [t, s, c] = await Promise.all([
        allTerritories(),
        apiFetch<Page<Specialty>>('/v1/specialties', { query: { limit: 200 } }),
        apiFetch<Page<DoctorCategory>>('/v1/doctor-categories', { query: { limit: 200 } }),
      ]);
      return {
        territories: t.filter((x) => !x.deletedAt),
        specialties: s.items.filter((x) => !x.deletedAt),
        categories: c.items.filter((x) => !x.deletedAt),
      };
    },
  });
  return useMemo(() => {
    const d = q.data ?? { territories: [], specialties: [], categories: [] };
    const byId = new Map<string, string>();
    for (const r of [...d.territories, ...d.specialties, ...d.categories]) byId.set(r.id, r.name);
    return { ...d, byId, ready: !!q.data };
  }, [q.data]);
}

export type Option = { value: string; label: string; hint?: string };

/** Select options per field type (web field-input.tsx). */
export function optionsFor(type: FieldDef['type'], lk: Lookups): Option[] | null {
  if (type === 'territory')
    return lk.territories.map((t) => ({
      value: t.id,
      label: `${t.name} (${t.code})`,
      hint: t.level,
    }));
  if (type === 'specialty') return lk.specialties.map((s) => ({ value: s.id, label: s.name }));
  if (type === 'category')
    return lk.categories.map((c) => ({
      value: c.id,
      label: `${c.name} · ${c.visitsPerMonth}/month`,
    }));
  return null;
}

// ---------- list / detail ----------

export type ListFilters = Partial<Record<'territoryId' | 'specialtyId' | 'categoryId', string>>;

export function useMasterList(kind: MasterKind, q: string, filters: ListFilters) {
  return useInfiniteQuery({
    queryKey: ['masters', kind, 'list', q, filters],
    initialPageParam: undefined as string | undefined,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam, signal }) => {
      const page = await apiFetch<Page<MasterRow>>(MASTERS[kind].path, {
        signal,
        query: {
          limit: 50,
          cursor: pageParam,
          q: q.trim() || undefined,
          includeTotal: 'true',
          ...Object.fromEntries(FILTERS[kind].map((k) => [k, filters[k]])),
        },
      });
      return { ...page, items: page.items.filter((r) => !r.deletedAt) };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMasterRecord(kind: MasterKind, id: string | undefined) {
  return useQuery({
    queryKey: ['masters', kind, 'one', id],
    enabled: !!id,
    queryFn: ({ signal }) => apiFetch<MasterRow>(`${MASTERS[kind].path}/${id}`, { signal }),
  });
}

// ---------- writes (web record-sheet.tsx) ----------

export function useSaveMaster(kind: MasterKind, row: MasterRow | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      values,
      allowPossibleDuplicate,
    }: {
      values: Values;
      allowPossibleDuplicate?: boolean;
    }) => {
      const path = MASTERS[kind].path;
      if (row)
        return apiFetch<MasterRow>(`${path}/${row.id}`, {
          method: 'PATCH',
          body: { ...values, location: row.location, version: row.version },
        });
      return apiFetch<MasterRow>(path, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey() },
        body: {
          ...values,
          location: null,
          ...(allowPossibleDuplicate ? { allowPossibleDuplicate: true } : {}),
        },
      });
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['masters', kind] });
      if (saved?.id) qc.setQueryData(['masters', kind, 'one', saved.id], saved);
    },
  });
}

export function useRemoveMaster(kind: MasterKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`${MASTERS[kind].path}/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['masters', kind] }),
  });
}

/** Doctors add form: live duplicate check (POST /v1/doctors/duplicate-check), debounced. */
export async function duplicateCheck(name: string, pincode: string | null, registrationNo: string) {
  const r = await apiFetch<{ matches: DoctorDuplicate[] }>('/v1/doctors/duplicate-check', {
    method: 'POST',
    body: {
      name,
      pincode: pincode && PIN.test(pincode) ? pincode : null,
      registrationNo: registrationNo || null,
    },
  });
  return r.matches;
}

export const RULE_LABEL = {
  registration_no: 'Same registration no.',
  name_pincode: 'Same name and PIN code',
} as const;

/** The website's save-error words (record-sheet.tsx). */
export function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'VERSION_CONFLICT')
      return 'Someone else changed this record. Go back and reopen it to see the latest.';
    if (err.code === 'VALIDATION')
      return 'The server rejected some fields. Check them and try again.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong. Try again.';
}
