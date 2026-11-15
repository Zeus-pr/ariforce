/**
 * Close open punch-ins for local calendar days that have already ended.
 * Used lazily on punch_in / MeToday so attendance does not stay "incomplete" overnight.
 */
import { geoCaptures, type Tx } from '@ariforce/db';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { addDays, localDate } from './field.util';

const dayOf = (tz: string) => sql`(${geoCaptures.capturedAt} at time zone ${tz})::date`;

/** Last millisecond of YYYY-MM-DD in `tz` (UTC Date). */
export function endOfLocalDay(day: string, tz: string): Date {
  const next = addDays(day, 1);
  let lo = Date.parse(`${day}T00:00:00.000Z`) - 14 * 3_600_000;
  let hi = Date.parse(`${next}T00:00:00.000Z`) + 14 * 3_600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(new Date(mid), tz) >= next) hi = mid;
    else lo = mid;
  }
  return new Date(hi - 1);
}

/**
 * Insert system `punch_out` rows for this user on every local day **before** `beforeDay`
 * that has punch_in and no punch_out (look back up to 7 days).
 */
export async function autoCloseOpenPunches(
  tx: Tx,
  opts: { companyId: string; userId: string; timezone: string; beforeDay: string },
): Promise<number> {
  let closed = 0;
  for (let i = 1; i <= 7; i++) {
    const day = addDays(opts.beforeDay, -i);
    const rows = await tx
      .select()
      .from(geoCaptures)
      .where(and(eq(geoCaptures.userId, opts.userId), sql`${dayOf(opts.timezone)} = ${day}::date`));
    const pin = rows.find((r) => r.kind === 'punch_in');
    if (!pin || rows.some((r) => r.kind === 'punch_out')) continue;
    await tx.insert(geoCaptures).values({
      id: uuidv7(),
      companyId: opts.companyId,
      userId: opts.userId,
      deviceId: pin.deviceId,
      kind: 'punch_out',
      location: pin.location,
      accuracyM: pin.accuracyM,
      source: 'manual',
      isMock: false,
      entityType: 'attendance',
      entityId: null,
      distanceM: null,
      territoryId: pin.territoryId,
      selfieFileKey: null,
      capturedAt: endOfLocalDay(day, opts.timezone),
    });
    closed++;
  }
  return closed;
}
