/** Paise integers. A null month is empty. A year and a quarter are splits of these months. */

export const MONTHS = 12;
const SEP = '\u001f';

export type Kind = 'primary' | 'secondary';
export type Months = (number | null)[];
export type Sheet = { cells: Record<string, Months> };

export type SaveOp =
  | {
      op: 'put';
      territoryId: string;
      brand: string | null;
      kind: Kind;
      month: string;
      rupees: number;
    }
  | { op: 'delete'; id: string };

export function sheetKey(territoryId: string, brand: string, kind: Kind) {
  return `${territoryId}${SEP}${brand}${SEP}${kind}`;
}

export function idKey(territoryId: string, brand: string, kind: Kind, month: string) {
  return `${territoryId}${SEP}${brand}${SEP}${kind}${SEP}${month}`;
}

export function pointKey(territoryId: string, brand: string, kind: Kind, index: number) {
  return `${territoryId}${SEP}${brand}${SEP}${kind}${SEP}${index}`;
}

export function cloneSheet(sheet: Sheet): Sheet {
  return {
    cells: Object.fromEntries(
      Object.entries(sheet.cells).map(([key, months]) => [key, months.slice()]),
    ),
  };
}

export function emptyMonths(): Months {
  return Array.from({ length: MONTHS }, () => null);
}

export function readMonths(sheet: Sheet, territoryId: string, brand: string, kind: Kind): Months {
  return sheet.cells[sheetKey(territoryId, brand, kind)] ?? emptyMonths();
}

export function withMonths(
  sheet: Sheet,
  territoryId: string,
  brand: string,
  kind: Kind,
  months: Months,
): Sheet {
  return { cells: { ...sheet.cells, [sheetKey(territoryId, brand, kind)]: months } };
}

/** Empty input is null. Anything that is not rupees to two decimals is invalid. */
export function parseRupees(raw: string): number | null | undefined {
  const text = raw.trim().replace(/₹/g, '').replace(/,/g, '');
  if (!text) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return undefined;
  const [whole, frac = ''] = text.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise > 10_000_000_000_000) return undefined;
  return paise;
}

export function rupeesFromPaise(paise: number): number {
  return Number((Math.round(paise) / 100).toFixed(2));
}

export function sumPaise(months: readonly (number | null)[]): number | null {
  if (months.every((n) => n == null)) return null;
  return months.reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

/** Split paise across weights. The parts add back to the total. Zero weights split evenly. */
export function splitPaise(total: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const safe = Math.max(0, Math.round(total));
  const baseWeights = weights.some((w) => w > 0)
    ? weights.map((w) => Math.max(0, w))
    : weights.map(() => 1);
  const weightSum = baseWeights.reduce((sum, w) => sum + w, 0);
  const raw = baseWeights.map((w) => (safe * w) / weightSum);
  const parts = raw.map((n) => Math.floor(n));
  let left = safe - parts.reduce((sum, n) => sum + n, 0);
  const order = raw
    .map((n, index) => ({ index, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (let i = 0; left > 0; i++, left--) {
    const slot = order[i % order.length];
    if (!slot) break;
    parts[slot.index] = (parts[slot.index] ?? 0) + 1;
  }
  return parts;
}

export function applyMonths(
  months: Months,
  indexes: readonly number[],
  parts: readonly number[],
): Months {
  const next = months.slice();
  indexes.forEach((index, i) => {
    next[index] = parts[i] ?? 0;
  });
  return next;
}

export function applyYear(
  months: Months,
  total: number | null,
  weights: readonly number[],
): Months {
  if (total == null) return emptyMonths();
  return applyMonths(
    months,
    weights.map((_, i) => i),
    splitPaise(total, weights),
  );
}

export function applyQuarter(
  months: Months,
  quarter: number,
  total: number | null,
  weights: readonly number[],
): Months {
  const indexes = [quarter * 3, quarter * 3 + 1, quarter * 3 + 2];
  if (total == null) {
    const next = months.slice();
    for (const index of indexes) next[index] = null;
    return next;
  }
  return applyMonths(months, indexes, splitPaise(total, weights));
}

export function applyMonth(months: Months, index: number, total: number | null): Months {
  const next = months.slice();
  next[index] = total;
  return next;
}

/** Last year's actual shape, else last year's target shape, else an even split. */
export function spreadWeights(actual: readonly number[], target: readonly number[]): number[] {
  const count = Math.max(actual.length, target.length);
  const actuals = Array.from({ length: count }, (_, index) => Math.max(0, actual[index] ?? 0));
  const targets = Array.from({ length: count }, (_, index) => Math.max(0, target[index] ?? 0));
  if (actuals.some((n) => n > 0)) return actuals;
  if (targets.some((n) => n > 0)) return targets;
  return Array.from({ length: count }, () => 1);
}

export function gapPaise(whole: number | null, parts: readonly (number | null)[]): number | null {
  const placed = sumPaise(parts);
  if (whole == null && placed == null) return null;
  return (whole ?? 0) - (placed ?? 0);
}

export function saveOps(
  year: number,
  before: Sheet,
  after: Sheet,
  ids: Readonly<Record<string, string>>,
): SaveOp[] {
  const keys = new Set([...Object.keys(before.cells), ...Object.keys(after.cells)]);
  const ops: SaveOp[] = [];
  for (const key of keys) {
    const [territoryId, brand, kind] = key.split(SEP) as [string, string, Kind];
    if (!territoryId || (kind !== 'primary' && kind !== 'secondary')) continue;
    const prev = before.cells[key] ?? emptyMonths();
    const next = after.cells[key] ?? emptyMonths();
    for (let index = 0; index < MONTHS; index++) {
      const from = prev[index] ?? null;
      const to = next[index] ?? null;
      if (from === to) continue;
      const month = `${year}-${String(index + 1).padStart(2, '0')}`;
      if (to == null) {
        const id = ids[idKey(territoryId, brand, kind, month)];
        if (id) ops.push({ op: 'delete', id });
        continue;
      }
      ops.push({
        op: 'put',
        territoryId,
        brand: brand || null,
        kind,
        month,
        rupees: rupeesFromPaise(to),
      });
    }
  }
  return ops;
}
