'use client';

import type { Chemist, Doctor, Stockist } from '@ariforce/contracts';
import { ExportMenu } from '@/components/export/export-menu';
import type { ExportCell, ExportSpec } from '@/components/export/export';
import { useTableQuery } from '@/components/data-table/use-table-query';
import { APPROVAL_LABEL } from '@/components/pickers/pickers';
import { api, apiReady } from '@/lib/api';
import { allPages } from '@/lib/paging';
import { todayYmd } from '@/lib/period';
import { MASTERS, type MasterKind, type MasterRow } from './config';
import { useLookups } from './lookups';

const SORT_KEYS: Record<string, string> = { name: 'name', city: 'city', updated: 'updatedAt' };
const FILTERS: Record<MasterKind, string[]> = {
  doctors: ['territoryId', 'specialtyId', 'categoryId'],
  chemists: ['territoryId'],
  stockists: ['territoryId'],
};
const FILTER_LABEL: Record<string, string> = {
  territoryId: 'Territory',
  specialtyId: 'Specialty',
  categoryId: 'Category',
};

const DOCTOR_COLS = [
  'Name',
  'Qualification',
  'Specialty',
  'Category',
  'Territory',
  'Registration no.',
  'Phone',
  'Email',
  'Address',
  'City',
  'State',
  'PIN code',
  'Date of birth',
  'Anniversary',
  'Status',
];
const TRADE_COLS = [
  'Name',
  'Territory',
  'GSTIN',
  'Drug licence',
  'Phone',
  'Address',
  'City',
  'State',
  'PIN code',
];

function text(v: string | null | undefined): ExportCell {
  return v && v.length ? v : null;
}

function doctorRow(d: Doctor, name: (id: string | null | undefined) => ExportCell): ExportCell[] {
  return [
    d.name,
    text(d.qualification),
    name(d.specialtyId),
    name(d.categoryId),
    name(d.territoryId),
    text(d.registrationNo),
    text(d.phone),
    text(d.email),
    text(d.addressLine),
    text(d.city),
    text(d.state),
    text(d.pincode),
    text(d.dateOfBirth),
    text(d.anniversary),
    APPROVAL_LABEL[d.approvalStatus] ?? d.approvalStatus,
  ];
}

function tradeRow(
  r: Chemist | Stockist,
  name: (id: string | null | undefined) => ExportCell,
): ExportCell[] {
  return [
    r.name,
    name(r.territoryId),
    text(r.gstin),
    text(r.drugLicenseNo),
    text(r.phone),
    text(r.addressLine),
    text(r.city),
    text(r.state),
    text(r.pincode),
  ];
}

/** Every row the caller can see, including later pages, with the table's search and filters. */
export function MasterExport({ kind }: { kind: MasterKind }) {
  const lk = useLookups();
  const [query] = useTableQuery();
  const spec = async (): Promise<ExportSpec> => {
    await apiReady();
    const sortKey = query.sort ? SORT_KEYS[query.sort.id] : undefined;
    const filters = Object.fromEntries(
      FILTERS[kind].filter((k) => query.filters[k]).map((k) => [k, query.filters[k]]),
    );
    const loaded = await allPages<MasterRow>(
      (cursor) =>
        api.GET(MASTERS[kind].path, {
          params: {
            query: {
              limit: 200,
              cursor,
              q: query.query || undefined,
              ...(sortKey ? { sort: (query.sort!.desc ? `-${sortKey}` : sortKey) as 'name' } : {}),
              ...filters,
            },
          },
        }),
      50,
    );
    if (!loaded.data)
      throw new Error(
        (loaded.error as { error?: { message?: string } })?.error?.message ?? 'Could not load.',
      );
    if (loaded.truncated) throw new Error('This list is too long to download in one file.');
    const items = loaded.data.items.filter((r) => !r.deletedAt);
    const name = (id: string | null | undefined) => (id ? (lk.byId.get(id) ?? null) : null);
    const title = MASTERS[kind].title;
    const meta = [`${items.length.toLocaleString('en-IN')} ${title.toLowerCase()}`];
    if (query.query) meta.push(`Search: ${query.query}`);
    for (const [k, v] of Object.entries(filters))
      if (v) meta.push(`${FILTER_LABEL[k] ?? k}: ${lk.byId.get(v) ?? v}`);
    meta.push(`Exported ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
    const columns = (kind === 'doctors' ? DOCTOR_COLS : TRADE_COLS).map((header) => ({
      header,
      width: header === 'Name' || header === 'Address' ? 28 : 18,
    }));
    return {
      title,
      meta,
      columns,
      rows:
        kind === 'doctors'
          ? items.map((r) => doctorRow(r as Doctor, name))
          : items.map((r) => tradeRow(r as Chemist | Stockist, name)),
      fileName: `ariforce-${kind}-${todayYmd()}`,
    };
  };
  return <ExportMenu spec={spec} disabled={!lk.ready} size="default" />;
}
