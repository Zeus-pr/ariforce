import type { DcrBand } from '@ariforce/contracts';

/**
 * SFC categories and DCR bands (web lib/dcr/bands.ts). Exact hq/ex/os in any case are
 * accepted; combined or unknown values are ignored.
 */
export type SfcCat = 'hq' | 'ex' | 'os';
export const CATEGORY_BAND: Record<SfcCat, DcrBand> = { hq: 'hq', ex: 'ex_hq', os: 'outstation' };
const BANDS: readonly DcrBand[] = ['hq', 'ex_hq', 'outstation'];

const norm = (raw: unknown) => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');

export function sfcCategoryOf(raw: unknown): SfcCat | null {
  const v = norm(raw);
  return v === 'hq' || v === 'ex' || v === 'os' ? v : null;
}

export function bandOf(raw: unknown): DcrBand | null {
  const v = norm(raw);
  if ((BANDS as readonly string[]).includes(v)) return v as DcrBand;
  const c = sfcCategoryOf(v);
  return c ? CATEGORY_BAND[c] : null;
}

export const categoryFitsBand = (category: unknown, band: DcrBand) => {
  const c = sfcCategoryOf(category);
  return !!c && CATEGORY_BAND[c] === band;
};
