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
  dcrLockAfterHours: number;
  version: number;
}
export async function companySettings(tx: Tx, p: Principal): Promise<CompanySettings> {
  const [c] = await tx.select().from(companies).where(eq(companies.id, p.companyId));
  if (!c) throw new Error('company row not visible');
  return {
    timezone: c.timezone,
    radiusM: c.defaultGeofenceM,
    maxAccuracyM: c.geofenceMaxAccuracyM,
    blockOutOfFence: c.geofenceBlockOutOfFence,
    blockMockLocation: c.geofenceBlockMock,
    dcrLockAfterHours: c.dcrLockAfterHours,
    version: c.version,
  };
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
