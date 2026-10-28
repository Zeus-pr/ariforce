import { SFC_CATEGORY_BAND, type DcrBand, type SfcCategory } from '@ariforce/contracts';

/** Where a DCR SFC candidate came from: the filer's own route, or the HQ fallback. */
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
}

/** Same key as the SFC data fixes: upper case, every non-alphanumeric removed. */
export const sfcPlaceKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

const time = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));
const byOwnOrder = (a: SfcRouteLike, b: SfcRouteLike) =>
  a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byStable = (a: SfcRouteLike, b: SfcRouteLike) =>
  a.sortOrder - b.sortOrder ||
  time(a.createdAt) - time(b.createdAt) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const inBand = (band: DcrBand) => (r: SfcRouteLike) =>
  r.category !== null && SFC_CATEGORY_BAND[r.category as SfcCategory] === band;

/**
 * DCR SFC candidates per HQ: the single source of truth for sfc-match, draft/submit validation
 * and the submit snapshot (TA/DA).
 *
 * `rows` = every live (deleted_at null) sfc_routes row on `hqIds`, any owner, any category,
 * read through the tenant (RLS, company-scoped) transaction.
 *
 * Per HQ (not per band): if the filer owns ANY live route on that HQ, only the filer's routes
 * count (band-filtered, sort_order then id, as before). Otherwise the HQ fallback: every owner's
 * routes on that HQ in the band, de-duplicated on (normalised from_place, normalised to_place,
 * category); the winner is the lowest sort_order, then the oldest created_at, then the lowest id.
 * Output keeps HQ order of `hqIds`; fallback rows are ordered by the same stable key.
 */
export function resolveSfcCandidates<R extends SfcRouteLike>(
  rows: R[],
  userId: string,
  hqIds: string[],
  band: DcrBand,
): (R & { source: SfcSource })[] {
  const out: (R & { source: SfcSource })[] = [];
  const keep = inBand(band);
  for (const hq of new Set(hqIds)) {
    const onHq = rows.filter((r) => r.hqTerritoryId === hq);
    const own = onHq.filter((r) => r.userId === userId);
    if (own.length) {
      for (const r of own.filter(keep).sort(byOwnOrder)) out.push({ ...r, source: 'own' });
      continue;
    }
    const seen = new Set<string>();
    for (const r of onHq.filter(keep).sort(byStable)) {
      const k = `${sfcPlaceKey(r.fromPlace)}\u0000${sfcPlaceKey(r.toPlace)}\u0000${r.category}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...r, source: 'hq' });
    }
  }
  return out;
}
