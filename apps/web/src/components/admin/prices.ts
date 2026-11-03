import type { components } from '@ariforce/contracts';

export type AdminProduct = components['schemas']['AdminProduct'];
export type BulkResult = components['schemas']['ProductPricesBulkResult'];
export const PRICE_KEYS = ['mrp', 'ptr', 'pts'] as const;
export type PriceKey = (typeof PRICE_KEYS)[number];
export type PriceEdit = Partial<Record<PriceKey, string>>;
export const BULK_CHUNK = 300;
export const PRICE_MAX = 1_000_000;

/** '' clears the price (null); otherwise a number 0..1,000,000 with at most 2 decimals. */
export function parsePrice(
  v: string,
): { ok: true; value: number | null } | { ok: false; message: string } {
  const t = v.trim().replace(/,/g, '');
  if (t === '') return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t))
    return { ok: false, message: 'Use a number with at most 2 decimals.' };
  const n = Number(t);
  if (n > PRICE_MAX) return { ok: false, message: 'Price must be at most 10,00,000.' };
  return { ok: true, value: n };
}

export const fmt = (n: number | null) => (n == null ? '' : String(n));

/** Changed fields of an edited row, validated, with PTR ≤ MRP on the merged row. */
export function diff(
  p: AdminProduct,
  e: PriceEdit | undefined,
): { ok: true; patch: Partial<Record<PriceKey, number | null>> } | { ok: false; message: string } {
  const patch: Partial<Record<PriceKey, number | null>> = {};
  for (const k of PRICE_KEYS) {
    if (e?.[k] === undefined) continue;
    const r = parsePrice(e[k]!);
    if (!r.ok) return { ok: false, message: `${k.toUpperCase()}: ${r.message}` };
    if (r.value !== p[k]) patch[k] = r.value;
  }
  const mrp = 'mrp' in patch ? patch.mrp : p.mrp;
  const ptr = 'ptr' in patch ? patch.ptr : p.ptr;
  if (mrp != null && ptr != null && ptr > mrp)
    return { ok: false, message: 'PTR cannot be above MRP.' };
  return { ok: true, patch };
}

export function priceError(code: string | undefined, message?: string): string {
  if (code === 'VERSION_CONFLICT')
    return 'This product was changed by someone else. Reload to see the latest prices.';
  if (code === 'PTR_ABOVE_MRP') return 'PTR cannot be above MRP.';
  if (code === 'PRODUCT_NOT_FOUND') return 'This product no longer exists.';
  if (code === 'FORBIDDEN') return 'Only the System Admin can change product prices.';
  return message || 'Could not save. Try again.';
}

export function chunks<T>(rows: T[], n = BULK_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n));
  return out;
}
