import { SFC_CATEGORY_BAND, type DcrBand, type SfcCategory } from '@ariforce/contracts';

/** Kept on the wire. New matches are always the person's own route. */
export type SfcSource = 'own' | 'hq';

/** The sfc_routes columns the resolution needs (a full row satisfies it). */
export interface SfcRouteLike {
  id: string;
  userId: string;
  hqTerritoryId: string;
  category: string | null;
  fromPlace: string;
  toPlace: string;
  sortOrder: number;
  createdAt: Date | string;
  oneWayKm?: string | number | null;
  bothWayAmount?: string | number | null;
  da?: string | number | null;
  actualFare?: boolean | null;
}

const byOwnOrder = (a: SfcRouteLike, b: SfcRouteLike) =>
  a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const inBand = (band: DcrBand) => (r: SfcRouteLike) =>
  r.category !== null && SFC_CATEGORY_BAND[r.category as SfcCategory] === band;

/** Same key as the SFC data fixes: upper case, every non-alphanumeric removed. */
export const sfcPlaceKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

const moneyKey = (v: string | number | null | undefined) => {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
};

/** One journey. A second saved copy with the same places, band and fare is the same route. */
export const sfcJourneyKey = (r: SfcRouteLike) =>
  [
    sfcPlaceKey(r.fromPlace),
    sfcPlaceKey(r.toPlace),
    (r.category ?? '').trim().toLowerCase(),
    moneyKey(r.oneWayKm),
    moneyKey(r.bothWayAmount),
    moneyKey(r.da),
    r.actualFare ? '1' : '0',
  ].join('\u0000');

/**
 * One chart per person: that person's live routes in `band`, in chart order.
 * The headquarters a row was filed under does not hide it or repeat it.
 * Nobody else's routes are included. An identical journey filed twice is listed once.
 */
export function resolveSfcCandidates<R extends SfcRouteLike>(
  rows: R[],
  userId: string,
  band: DcrBand,
): (R & { source: SfcSource })[] {
  const seen = new Set<string>();
  const out: (R & { source: SfcSource })[] = [];
  for (const r of rows
    .filter((row) => row.userId === userId && inBand(band)(row))
    .sort(byOwnOrder)) {
    const key = sfcJourneyKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, source: 'own' });
  }
  return out;
}
