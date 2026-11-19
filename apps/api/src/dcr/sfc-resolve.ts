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
}

const byOwnOrder = (a: SfcRouteLike, b: SfcRouteLike) =>
  a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const inBand = (band: DcrBand) => (r: SfcRouteLike) =>
  r.category !== null && SFC_CATEGORY_BAND[r.category as SfcCategory] === band;

/**
 * One chart per person: that person's live routes in `band`, in chart order.
 * The headquarters stored on a row does not hide it, and nobody else's routes are included.
 */
export function resolveSfcCandidates<R extends SfcRouteLike>(
  rows: R[],
  userId: string,
  band: DcrBand,
): (R & { source: SfcSource })[] {
  return rows
    .filter((r) => r.userId === userId && inBand(band)(r))
    .sort(byOwnOrder)
    .map((r) => ({ ...r, source: 'own' as const }));
}
