/**
 * SFC (Standard Fare Chart) data layer: the only file that knows the SFC endpoints.
 * Contract: Architect's feat/sfc-routes (docs/SFC.md, packages/contracts/src/schemas/sfc.ts).
 *   GET  /v1/sfc/settings                              -> { ratePerKm, version }  (one company-wide rate, default 2.95)
 *   GET  /v1/sfc/hqs                                   -> { items: [{ id, name, code, level, parentId, parentName, ... }] }
 *   GET  /v1/sfc/employees?territoryId=                -> { items: [{ id, name, employeeCode, role, rank, hqTerritoryIds, canEdit, ... }] }
 *   GET  /v1/sfc/employees/{userId}/routes             -> { userId, userName, hqTerritoryId, ratePerKm, etag, canEdit, routes[] }
 *   PUT  /v1/sfc/employees/{userId}/routes  { etag, hqTerritoryId, routes[] } (whole table in order; omitted rows deleted)
 * Errors: 403 FORBIDDEN, 404 NOT_FOUND, 409 VERSION_CONFLICT (details.etag), 422 VALIDATION /
 * SFC_HQ_NOT_ASSIGNED / SFC_ROUTE_NOT_FOUND, 429. Amounts are computed by the server; the web shows
 * the same rule (km x rate, both way = 2x) while typing. DA is a money amount (number or null).
 */
import { sfcCategoryFromLabel, sfcCategoryLabel } from '@ariforce/contracts';
import { API_URL, apiReady } from '@/lib/api';

export const DEFAULT_RATE = 2.95;
/** Display labels for the contract's SfcTravelMode values. */
const MODE: Record<string, string> = {
  bike: 'BIKE',
  bus: 'BUS',
  train: 'TRAIN',
  bus_train: 'BUS / TRAIN',
  car: 'CAR',
  other: 'OTHER',
};
const MODE_KEY = Object.fromEntries(Object.entries(MODE).map(([k, v]) => [v, k]));
export const TRAVEL_MODES = Object.values(MODE);
/** DA limits (contract Money allows up to 10,00,000; the web caps DA lower as a sanity check). */
export const DA_MAX = 100000;
export const CATEGORIES = ['HQ', 'EX', 'EX HQ', 'EX / OS', 'OS', 'OUT EX HQ', 'MEETING'] as const;

export type SfcHq = {
  id: string;
  name: string;
  code: string | null;
  areaId: string | null;
  areaName: string | null;
};
export type SfcEmployee = {
  id: string;
  name: string;
  employeeCode: string | null;
  role: string | null;
  hqId: string | null;
  canEdit: boolean;
};
export type SfcRow = {
  id: string;
  fromPlace: string;
  toPlace: string;
  /** One-way distance in km; null while blank. */
  distanceKm: number | null;
  /** 'ACTUAL FARE' rows show that text instead of an amount. */
  actualFare: boolean;
  travelMode: string;
  category: string;
  /** Daily allowance in INR; null when blank. */
  da: number | null;
};
export type SfcSheet = {
  userId: string;
  hqId: string | null;
  /** Table etag from the last GET ("" for a table that never had rows). */
  etag: string;
  canEdit: boolean;
  ratePerKm: number;
  rows: SfcRow[];
};
export type SfcFailure = {
  code: string;
  status: number;
  kind: 'conflict' | 'forbidden' | 'missing' | 'invalid' | 'busy' | 'other';
  message: string;
  /** Zero-based row the API rejected, when it says. */
  row?: number;
};

/** Money to 2 places (avoids 0.1 + 0.2 noise). */
export const money = (n: number) => Math.round(n * 100) / 100;
export const oneWayAmount = (km: number | null, rate: number) =>
  km == null ? null : money(km * rate);

const MESSAGES: Record<SfcFailure['kind'], string> = {
  conflict:
    'Someone else saved this SFC while you were editing. The latest version is loaded; make your changes again.',
  forbidden: 'You can’t view or change this SFC.',
  missing: 'This person or SFC no longer exists. Pick again.',
  invalid: 'Some rows are not valid.',
  busy: 'Too many saves in a short time. Wait a minute and try again.',
  other: 'Something went wrong. Try again.',
};

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  await apiReady();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init?.method ?? 'GET',
      credentials: 'include',
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw {
      code: 'NETWORK',
      status: 0,
      kind: 'other',
      message: 'Could not reach the server.',
    } satisfies SfcFailure;
  }
  if (res.ok) return (await res.json()) as T;
  const b = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string; details?: { rows?: number[] } };
  };
  const code = b.error?.code ?? String(res.status);
  const kind: SfcFailure['kind'] =
    res.status === 409 || code === 'VERSION_CONFLICT'
      ? 'conflict'
      : res.status === 403
        ? 'forbidden'
        : res.status === 404
          ? 'missing'
          : res.status === 422
            ? 'invalid'
            : res.status === 429
              ? 'busy'
              : 'other';
  let row: number | undefined;
  let message = MESSAGES[kind];
  if (kind === 'invalid') {
    const m = b.error?.message ?? '';
    const hit = b.error?.details?.rows?.[0] ?? Number(/routes\.(\d+)/.exec(m)?.[1] ?? NaN);
    if (Number.isInteger(hit)) row = hit;
    else {
      const r = /Row (\d+)/.exec(m);
      if (r) row = Number(r[1]) - 1;
    }
    message =
      code === 'SFC_HQ_NOT_ASSIGNED'
        ? 'This HQ is no longer assigned to this person. Pick the HQ again.'
        : code === 'SFC_ROUTE_NOT_FOUND'
          ? 'A row was removed by someone else. The latest version is loaded.'
          : row != null
            ? `Row ${row + 1} is not valid. ${m.replace(/^Row \d+:\s*/, '')}`.trim()
            : `${MESSAGES.invalid} ${m}`.trim();
  }
  throw { code, status: res.status, kind, message, row } satisfies SfcFailure;
}

export const asFailure = (e: unknown): SfcFailure =>
  e && typeof e === 'object' && 'kind' in e
    ? (e as SfcFailure)
    : { code: 'UNKNOWN', status: 0, kind: 'other', message: MESSAGES.other };

type ApiRoute = {
  id: string;
  fromPlace: string;
  toPlace: string;
  oneWayKm: number;
  actualFare: boolean;
  travelMode: string | null;
  category: string | null;
  da: number | null;
};
type ApiTable = {
  userId: string;
  hqTerritoryId: string | null;
  ratePerKm: number;
  etag: string;
  canEdit: boolean;
  routes: ApiRoute[];
};
const fromApi = (t: ApiTable): SfcSheet => ({
  userId: t.userId,
  hqId: t.hqTerritoryId,
  etag: t.etag,
  canEdit: t.canEdit,
  ratePerKm: t.ratePerKm,
  rows: t.routes.map((r) => ({
    id: r.id,
    fromPlace: r.fromPlace,
    toPlace: r.toPlace,
    distanceKm: r.oneWayKm,
    actualFare: r.actualFare,
    travelMode: r.travelMode ? (MODE[r.travelMode] ?? r.travelMode.toUpperCase()) : '',
    category: sfcCategoryLabel(r.category),
    da: r.da,
  })),
});

/** The one company-wide rate (not per HQ). */
/** One company-wide rate. `version` is null when the settings could not be read (rate falls back). */
export type SfcSettings = { ratePerKm: number; version: number | null };
export async function getSettings(): Promise<SfcSettings> {
  const r = await call<{ ratePerKm?: number; version?: number }>('/v1/sfc/settings').catch(
    () => null,
  );
  return {
    ratePerKm: typeof r?.ratePerKm === 'number' && r.ratePerKm > 0 ? r.ratePerKm : DEFAULT_RATE,
    version: typeof r?.version === 'number' ? r.version : null,
  };
}
export const getRate = () => getSettings().then((s) => s.ratePerKm);
/** PUT /v1/sfc/settings (settings:write: Director, System Admin). 409 VERSION_CONFLICT on a stale version. */
export const saveRate = (ratePerKm: number, version: number) =>
  call<SfcSettings>('/v1/sfc/settings', { method: 'PUT', body: { ratePerKm, version } });
export const listHqs = () =>
  call<{
    items: {
      id: string;
      name: string;
      code: string | null;
      parentId: string | null;
      parentName: string | null;
    }[];
  }>('/v1/sfc/hqs').then((r) =>
    r.items.map((h) => ({
      id: h.id,
      name: h.name,
      code: h.code,
      areaId: h.parentId,
      areaName: h.parentName,
    })),
  );
export const listEmployees = (hqId: string) =>
  call<{
    items: {
      id: string;
      name: string;
      employeeCode: string | null;
      role: string | null;
      hqTerritoryIds: string[];
      canEdit: boolean;
    }[];
  }>(`/v1/sfc/employees?territoryId=${encodeURIComponent(hqId)}`).then((r) =>
    r.items.map((e) => ({
      id: e.id,
      name: e.name,
      employeeCode: e.employeeCode,
      role: e.role,
      hqId: e.hqTerritoryIds.includes(hqId) ? hqId : (e.hqTerritoryIds[0] ?? null),
      canEdit: e.canEdit,
    })),
  );
/** HQ/EX/EX HQ/OS/OUT EX HQ/EX / OS/MEETING, or the raw text when it is not one of those. */
function categoryForSave(label: string): string | null {
  const mapped = sfcCategoryFromLabel(label);
  if (mapped === undefined) return label.trim() || null;
  return mapped;
}

const path = (userId: string) => `/v1/sfc/employees/${encodeURIComponent(userId)}/routes`;
export const getSheet = (userId: string) => call<ApiTable>(path(userId)).then(fromApi);
/** Whole table in display order. Rows created in the browser (id "new-…") are sent without an id. */
export const saveSheet = (userId: string, etag: string, hqId: string, rows: SfcRow[]) =>
  call<ApiTable>(path(userId), {
    method: 'PUT',
    body: {
      etag,
      hqTerritoryId: hqId,
      routes: rows.map((r) => ({
        ...(r.id.startsWith('new-') ? {} : { id: r.id }),
        fromPlace: r.fromPlace,
        toPlace: r.toPlace,
        oneWayKm: r.distanceKm ?? 0,
        actualFare: r.actualFare,
        travelMode: MODE_KEY[r.travelMode] ?? (r.travelMode ? 'other' : null),
        category: categoryForSave(r.category),
        da: r.da,
      })),
    },
  }).then(fromApi);
