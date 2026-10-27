/**
 * SFC (standard fare chart) data layer. The only place that knows the SFC endpoints, so adopting the
 * Architect's final contract is a change here (and in ./mock-handler.ts).
 *
 * ASSUMED contract (pending API):
 *   GET  /v1/sfc/settings                -> { ratePerKm: number }            (default 2.95)
 *   GET  /v1/sfc/hqs                      -> { items: SfcHq[] }               (caller's scope, HQ level)
 *   GET  /v1/sfc/employees?hqId=          -> { items: SfcEmployee[] }         (people under the caller at that HQ)
 *   GET  /v1/sfc/{userId}                 -> SfcSheet
 *   PUT  /v1/sfc/{userId}  {version, rows} -> SfcSheet                         (replaces all rows, in order)
 * Errors: 409 VERSION_CONFLICT, 403 FORBIDDEN, 404 NOT_FOUND, 422 VALIDATION (details.rows), 429.
 * Amounts are not stored: one-way amount = km x rate, both-way = 2 x one-way (ACTUAL FARE rows show text).
 */
import { API_URL, MOCKING, apiReady } from '@/lib/api';

export const DEFAULT_RATE = 2.95;
export const TRAVEL_MODES = [
  'BIKE',
  'BUS',
  'TRAIN',
  'BUS / TRAIN',
  'CAR',
  'AUTO',
  'OTHER',
] as const;
export const CATEGORIES = ['HQ', 'EX', 'EX HQ', 'EX / OS', 'OS', 'OUT EX HQ', 'MEETING'] as const;

export type SfcHq = { id: string; name: string; code: string; areaId: string; areaName: string };
export type SfcEmployee = {
  id: string;
  name: string;
  employeeCode: string | null;
  role: string;
  hqId: string;
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
  /** Free text, blank by default. */
  da: string;
};
export type SfcSheet = {
  userId: string;
  hqId: string;
  version: number;
  rows: SfcRow[];
  updatedAt: string | null;
};
export type SfcFailure = {
  code: string;
  status: number;
  kind: 'conflict' | 'forbidden' | 'missing' | 'invalid' | 'busy' | 'other';
  message: string;
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
  if (MOCKING && typeof window !== 'undefined') {
    // Mock mode: the SFC mock scopes by persona, like the other principal-aware mocks.
    try {
      const s = JSON.parse(localStorage.getItem('af:mock-session') ?? 'null') as {
        role?: string;
        previewRole?: string;
      } | null;
      const who = s?.previewRole ?? s?.role;
      if (who) headers['x-mock-user'] = who;
    } catch {
      /* default persona */
    }
  }
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
  const b = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
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
  const message =
    kind === 'invalid' && b.error?.message
      ? `${MESSAGES.invalid} ${b.error.message}`
      : MESSAGES[kind];
  throw { code, status: res.status, kind, message } satisfies SfcFailure;
}

export const asFailure = (e: unknown): SfcFailure =>
  e && typeof e === 'object' && 'kind' in e
    ? (e as SfcFailure)
    : { code: 'UNKNOWN', status: 0, kind: 'other', message: MESSAGES.other };

export async function getRate(): Promise<number> {
  const r = await call<{ ratePerKm?: number }>('/v1/sfc/settings').catch(() => null);
  return typeof r?.ratePerKm === 'number' && r.ratePerKm > 0 ? r.ratePerKm : DEFAULT_RATE;
}
export const listHqs = () => call<{ items: SfcHq[] }>('/v1/sfc/hqs').then((r) => r.items);
export const listEmployees = (hqId: string) =>
  call<{ items: SfcEmployee[] }>(`/v1/sfc/employees?hqId=${encodeURIComponent(hqId)}`).then(
    (r) => r.items,
  );
export const getSheet = (userId: string) => call<SfcSheet>(`/v1/sfc/${encodeURIComponent(userId)}`);
export const saveSheet = (userId: string, version: number, rows: SfcRow[]) =>
  call<SfcSheet>(`/v1/sfc/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: { version, rows },
  });
