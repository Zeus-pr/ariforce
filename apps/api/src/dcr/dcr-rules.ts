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
};
const idOf = (c: CallLike) => c.clientId ?? c.id ?? null;

/** POB is for chemist and stockist calls only. Returns the offending calls, or null. */
export function doctorPob(calls: CallLike[]) {
  const bad = calls.flatMap((c, i) =>
    c.outletKind === 'doctor' && c.pob.length ? [{ index: i, id: idOf(c) }] : [],
  );
  return bad.length
    ? {
        reason: 'POB_NOT_ALLOWED_FOR_DOCTOR' as const,
        callIndexes: bad.map((b) => b.index),
        callIds: bad.map((b) => b.id),
      }
    : null;
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
