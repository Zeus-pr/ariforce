import type { DcrBand } from '@ariforce/contracts';

/**
 * SFC categories and DCR bands from real data. After migration 0043 categories are lowercase
 * hq/ex/os, but legacy rows can still be mixed case ("Ex", " OS ") or combined/unknown
 * ("EX / OS", "MEETING"). Exact hq/ex/os in any case are accepted; anything else is ignored,
 * never shown as a band and never guessed.
 */
export type SfcCat = 'hq' | 'ex' | 'os';
export const CATEGORY_BAND: Record<SfcCat, DcrBand> = { hq: 'hq', ex: 'ex_hq', os: 'outstation' };
const BANDS: readonly DcrBand[] = ['hq', 'ex_hq', 'outstation'];

const norm = (raw: unknown) => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');

/** 'hq' | 'ex' | 'os' for an exact category in any case/spacing; null for combined or unknown values. */
export function sfcCategoryOf(raw: unknown): SfcCat | null {
  const v = norm(raw);
  return v === 'hq' || v === 'ex' || v === 'os' ? v : null;
}

/** A DCR band from a band value (hq/ex_hq/outstation) or an exact category, any case; else null. */
export function bandOf(raw: unknown): DcrBand | null {
  const v = norm(raw);
  if ((BANDS as readonly string[]).includes(v)) return v as DcrBand;
  const c = sfcCategoryOf(v);
  return c ? CATEGORY_BAND[c] : null;
}

/** True when a route's category is exactly the category of `band`. */
export const categoryFitsBand = (category: unknown, band: DcrBand) => {
  const c = sfcCategoryOf(category);
  return !!c && CATEGORY_BAND[c] === band;
};
