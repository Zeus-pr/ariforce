/**
 * POB desk: today's chemist/stockist order lines from the caller's DCR (no separate POB API).
 */
import type { Dcr, DcrCall } from '@ariforce/contracts';
import { lineValue, type ProductOpt } from './dcr/adapter';
import type { DcrOptions } from './dcr/api';
import { ApiError } from './api';

export type PobOutletKind = 'chemist' | 'stockist';

export type PobCallRow = {
  callId: string;
  outletKind: PobOutletKind;
  outletId: string;
  lines: { productId: string; quantity: number; value: number }[];
  total: number;
  productCount: number;
};

const KIND_LABEL: Record<PobOutletKind, string> = {
  chemist: 'Chemist',
  stockist: 'Stockist',
};

export const pobKindLabel = (k: PobOutletKind) => KIND_LABEL[k];

/** Prefer today's live draft, else submitted, else first draft in options. */
export function todayDcr(options: DcrOptions | undefined): Dcr | null {
  if (!options) return null;
  return options.dcr ?? options.submitted ?? options.drafts?.[0] ?? null;
}

function isPobOutlet(kind: DcrCall['outletKind']): kind is PobOutletKind {
  return kind === 'chemist' || kind === 'stockist';
}

/** Chemist/stockist calls with at least one POB line, valued at PTS on screen. */
export function pobCallsFromDcr(
  dcr: Dcr | null,
  products: ReadonlyMap<string, ProductOpt>,
): PobCallRow[] {
  if (!dcr) return [];
  const rows: PobCallRow[] = [];
  for (const c of dcr.calls) {
    if (!isPobOutlet(c.outletKind) || !c.pob.length) continue;
    const ptsOf = (id: string) => products.get(id)?.pts ?? null;
    const lines = c.pob.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      value: lineValue(ptsOf(l.productId), l.quantity),
    }));
    rows.push({
      callId: c.id,
      outletKind: c.outletKind,
      outletId: c.outletId,
      lines,
      total: lines.reduce((s, l) => s + l.value, 0),
      productCount: lines.length,
    });
  }
  return rows;
}

export function pobDayTotal(rows: PobCallRow[]) {
  return rows.reduce((s, r) => s + r.total, 0);
}

export function pobMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Could not load today's orders.";
}
