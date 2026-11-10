import { companies, type Tx } from '@ariforce/db';
import { eq } from 'drizzle-orm';
import type { Principal } from '../auth/principal';

export const NOTICE_VERSION = '2026-10-v1';
export const MAX_RANGE_DAYS = 62;

export interface CompanySettings {
  timezone: string;
  radiusM: number;
  maxAccuracyM: number;
  blockOutOfFence: boolean;
  blockMockLocation: boolean;
  presentationRadiusM: number;
  lockMaxAccuracyM: number;
  dcrLockAfterHours: number;
  version: number;
}
/**
 * Per-replica cache of company settings (read on almost every request). Key = company id, short
 * TTL (COMPANY_SETTINGS_CACHE_TTL_SECONDS, default 30, 0 = off), bounded size. Writers call
 * invalidateCompanySettings() in the transaction and again after commit; other replicas may serve
 * the old values for at most the TTL. Optimistic-concurrency reads (GET/PUT settings) pass fresh.
 */
const settingsCache = new Map<string, { until: number; value: CompanySettings }>();
const SETTINGS_CACHE_MAX = 1000;
function settingsTtlMs(): number {
  const raw = process.env.COMPANY_SETTINGS_CACHE_TTL_SECONDS;
  const n = raw === undefined || raw === '' ? 30 : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300) * 1000 : 0;
}
export function invalidateCompanySettings(companyId?: string) {
  if (companyId) settingsCache.delete(companyId);
  else settingsCache.clear();
}

export async function companySettings(
  tx: Tx,
  p: Principal,
  o: { fresh?: boolean } = {},
): Promise<CompanySettings> {
  const ttl = settingsTtlMs();
  const now = Date.now();
  if (ttl && !o.fresh) {
    const hit = settingsCache.get(p.companyId);
    if (hit && hit.until > now) return { ...hit.value };
  }
  const value = await loadCompanySettings(tx, p);
  if (ttl) {
    if (settingsCache.size >= SETTINGS_CACHE_MAX && !settingsCache.has(p.companyId))
      settingsCache.delete(settingsCache.keys().next().value!);
    settingsCache.set(p.companyId, { until: now + ttl, value });
  }
  return { ...value };
}

async function loadCompanySettings(tx: Tx, p: Principal): Promise<CompanySettings> {
  const [c] = await tx.select().from(companies).where(eq(companies.id, p.companyId));
  if (!c) throw new Error('company row not visible');
  return {
    timezone: c.timezone,
    radiusM: c.defaultGeofenceM,
    maxAccuracyM: c.geofenceMaxAccuracyM,
    blockOutOfFence: c.geofenceBlockOutOfFence,
    blockMockLocation: c.geofenceBlockMock,
    presentationRadiusM: c.presentationGeofenceM,
    lockMaxAccuracyM: c.geoLockMaxAccuracyM,
    dcrLockAfterHours: c.dcrLockAfterHours,
    version: c.version,
  };
}

/**
 * A punch is stored on the company-local today. The device clock must name that same day;
 * a capturedAt on another day is refused so the phone cannot choose the attendance day.
 */
export function punchOnCompanyToday(capturedDay: string, companyToday: string) {
  return capturedDay === companyToday;
}

/** Calendar date (YYYY-MM-DD) of an instant in the company time zone. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
export const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= MAX_RANGE_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Great-circle distance in metres (haversine). Portable: no PostGIS needed. */
export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
