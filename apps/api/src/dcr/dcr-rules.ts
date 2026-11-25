/** Pure DCR call rules (POB at PTS, doctor presentation, day lock). Unit-tested in dcr-rules.test.ts. */

/** Day lock (Sharanya, 2026-10-29): submit by 23:59 IST the same day; locks 00:00 IST next day. */
export const DCR_LOCK_TZ = 'Asia/Kolkata';

/** POB value = quantity × PTS (INR, 2 dp), or null when the product has no PTS. */
export const pobValue = (quantity: number, pts: string | null) =>
  pts == null ? null : (Math.round(quantity * Number(pts) * 100) / 100).toFixed(2);

type CallLike = {
  clientId?: string;
  id?: string;
  outletKind: 'doctor' | 'chemist' | 'stockist';
  pob: unknown[];
  productsDetailed: unknown[];
  presentationOpenedAt?: string | null;
  checkInId?: string | null;
};
const idOf = (c: CallLike) => c.clientId ?? c.id ?? null;

/** POB is for chemist calls only. Returns the offending calls, or null. */
export function doctorPob(calls: CallLike[]) {
  const bad = calls.flatMap((c, i) =>
    c.outletKind !== 'chemist' && c.pob.length ? [{ index: i, id: idOf(c) }] : [],
  );
  return bad.length
    ? {
        reason: 'POB_CHEMIST_ONLY' as const,
        callIndexes: bad.map((b) => b.index),
        callIds: bad.map((b) => b.id),
      }
    : null;
}

/**
 * Visit check-ins whose local day is not the DCR day. A call cannot reuse a check-in from
 * another day. Captures that are missing are not listed here (the caller already rejects those).
 */
export function foreignDayCheckInIds(
  dcrDate: string,
  calls: { checkInId?: string | null }[],
  captures: { id: string; day: string }[],
  /** Extra days that count, e.g. today while a past DCR is unlocked. */
  also: readonly string[] = [],
): string[] {
  const allowed = new Set([dcrDate, ...also]);
  const dayOf = new Map(captures.map((c) => [c.id, c.day]));
  return calls.flatMap((c) => {
    if (!c.checkInId) return [];
    const day = dayOf.get(c.checkInId);
    return day && !allowed.has(day) ? [c.checkInId] : [];
  });
}

/** On submit: every field call needs a visit check-in linked (geo at the outlet). */
export function missingCheckIns(calls: CallLike[]) {
  const bad = calls.flatMap((c, i) => (!c.checkInId ? [{ index: i, id: idOf(c) }] : []));
  return bad.length
    ? {
        reason: 'CALL_NOT_CHECKED_IN' as const,
        callIndexes: bad.map((b) => b.index),
        callIds: bad.map((b) => b.id),
      }
    : null;
}

const ABOVE_BM = new Set([
  'area_business_manager',
  'regional_business_manager',
  'zonal_business_manager',
  'sales_manager',
  'general_manager',
  'vice_president',
  'director',
]);

/** A business manager must open the presentation. ABM and above check in and submit. */
export function presentationRequired(roles: readonly string[]) {
  return roles.includes('business_manager') && !roles.some((r) => ABOVE_BM.has(r));
}

/** On submit: every doctor call with products detailed needs presentationOpenedAt. */
export function missingPresentation(calls: CallLike[]) {
  const bad = calls.flatMap((c, i) =>
    c.outletKind === 'doctor' && c.productsDetailed.length && !c.presentationOpenedAt
      ? [{ index: i, id: idOf(c) }]
      : [],
  );
  return bad.length
    ? {
        reason: 'PRESENTATION_NOT_OPENED' as const,
        callIndexes: bad.map((b) => b.index),
        callIds: bad.map((b) => b.id),
      }
    : null;
}

/** Lock instant of a DCR date (YYYY-MM-DD): 00:00 Asia/Kolkata (UTC+5:30, no DST) the next day. */
export function lockAtOf(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00+05:30`) + 86_400_000);
}
