'use client';

import { useCallback, useMemo } from 'react';
import { Label } from '@ariforce/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ariforce/ui/components/select';
import { useLookups } from '@/components/masters/lookups';
import { MOCKING, api, apiReady, toApiError } from '@/lib/api';
import { AsyncPicker, type PickOption, type PickPage } from './async-picker';

export type OutletKind = 'doctor' | 'chemist' | 'stockist';
const PAGE = MOCKING ? 2 : 25;
export const APPROVAL_LABEL: Record<string, string> = { pending: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected' };
const ALL = '__all';

type Row = { id: string; name: string; city?: string | null; territoryId?: string | null; approvalStatus?: string };

async function outletPage(kind: OutletKind, q: string, territoryId: string | undefined, cursor: string | undefined, territoryName: (id?: string | null) => string | undefined, rejectDisabled: boolean): Promise<PickPage> {
  await apiReady();
  const query = { limit: PAGE, sort: 'name' as const, ...(q ? { q } : {}), ...(territoryId ? { territoryId } : {}), ...(cursor ? { cursor } : {}) };
  const r =
    kind === 'doctor' ? await api.GET('/v1/doctors', { params: { query } })
    : kind === 'chemist' ? await api.GET('/v1/chemists', { params: { query } })
    : await api.GET('/v1/stockists', { params: { query } });
  if (!r.data) return { items: [], nextCursor: null, error: toApiError(r).message || 'Could not load the list.' };
  const items = (r.data.items as Row[]).map((x): PickOption => ({
    id: x.id,
    name: x.name,
    hint: [x.city, territoryName(x.territoryId)].filter(Boolean).join(' · ') || null,
    badge: kind === 'doctor' && x.approvalStatus && x.approvalStatus !== 'approved' ? APPROVAL_LABEL[x.approvalStatus] : null,
    disabledReason: rejectDisabled && x.approvalStatus === 'rejected' ? 'Rejected by your manager; cannot be reported' : null,
  }));
  return { items, nextCursor: r.data.nextCursor ?? null };
}

/** HQ/territory filter: the territories in the caller's scope (already scoped by the API). */
export function TerritoryFilter({ value, onChange, testId, label = 'Region / HQ', allLabel = 'All my territories' }: { value: string; onChange: (v: string) => void; testId: string; label?: string; allLabel?: string }) {
  const { territories } = useLookups();
  const sorted = useMemo(() => [...territories].sort((a, b) => a.path.split('.').length - b.path.split('.').length || a.name.localeCompare(b.name)), [territories]);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
        <SelectTrigger className="w-full" aria-label={label} data-testid={testId}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {sorted.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Searchable, server-paged doctor/chemist/stockist picker filtered by territory (incl. descendants). */
export function OutletPicker({ kind, territoryId, value, onChange, multiple, labels, testId, forReporting = false }: {
  kind: OutletKind;
  territoryId?: string;
  value: string[];
  onChange: (ids: string[], picked: PickOption[]) => void;
  multiple?: boolean;
  labels?: Map<string, string>;
  testId: string;
  /** DCR: rejected doctors can't be reported, so they are shown but disabled. */
  forReporting?: boolean;
}) {
  const { byId } = useLookups();
  const tn = useCallback((id?: string | null) => (id ? byId.get(id) : undefined), [byId]);
  const fetchPage = useCallback((q: string, cursor?: string) => outletPage(kind, q, territoryId || undefined, cursor, tn, forReporting), [kind, territoryId, tn, forReporting]);
  const noun = kind === 'doctor' ? 'doctors' : kind === 'chemist' ? 'chemists' : 'stockists';
  return (
    <AsyncPicker
      label={noun[0]!.toUpperCase() + noun.slice(1)}
      fetchPage={fetchPage}
      value={value}
      onChange={onChange}
      multiple={multiple}
      labels={labels}
      testId={testId}
      deps={[kind, territoryId, forReporting]}
      emptyText={`No ${noun} found in this area. Try another search or territory.`}
    />
  );
}

/** Searchable territory picker (server search on /v1/territories, scoped to the caller). */
export function TerritoryPicker({ value, onChange, testId, leavesOnly = true }: { value: string; onChange: (id: string) => void; testId: string; leavesOnly?: boolean }) {
  const { territories, byId } = useLookups();
  const leafIds = useMemo(() => new Set(territories.filter((t) => !territories.some((c) => c.parentId === t.id)).map((t) => t.id)), [territories]);
  const fetchPage = useCallback(async (q: string, cursor?: string): Promise<PickPage> => {
    await apiReady();
    const r = await api.GET('/v1/territories', { params: { query: { limit: PAGE * 4, sort: 'name', ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) } } });
    if (!r.data) return { items: [], nextCursor: null, error: toApiError(r).message || 'Could not load territories.' };
    const items = r.data.items
      .filter((t) => !leavesOnly || leafIds.size === 0 || leafIds.has(t.id))
      .map((t) => ({ id: t.id, name: t.name, hint: t.parentId ? byId.get(t.parentId) ?? null : null }));
    return { items, nextCursor: r.data.nextCursor ?? null };
  }, [leavesOnly, leafIds, byId]);
  return (
    <AsyncPicker label="Territories" fetchPage={fetchPage} value={value ? [value] : []} onChange={(ids) => onChange(ids[0] ?? '')} labels={byId} testId={testId} deps={[leafIds.size]} emptyText="No territories match. Ask your administrator if yours is missing." />
  );
}
