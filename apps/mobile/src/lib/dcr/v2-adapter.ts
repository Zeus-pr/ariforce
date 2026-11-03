import type { DcrDetails } from '@ariforce/contracts';

/**
 * DCR v2 adapter — the ONLY place that knows how "From place / To place" and DCR expenses
 * reach the API. The contracts have no such fields yet (assumed names below, pending Architect).
 *
 * - Flag off (default): places ride inside the existing `remarks` text as a tagged first line;
 *   the Expenses section is hidden and nothing about expenses is sent.
 * - Flag on (EXPO_PUBLIC_DCR_V2_FIELDS=1): sends the assumed fields instead.
 *     details.fromPlace / details.toPlace  (meeting, training, office)
 *     Dcr body `expenses: [{ category, amount, note }]`; response `expenseClaimId`,
 *     `expenseTotal`, `expenseCount`.
 */
export const DCR_V2_FIELDS = process.env.EXPO_PUBLIC_DCR_V2_FIELDS === '1';

export const DCR_EXPENSE_CATEGORIES = ['travel', 'hotel', 'food', 'other'] as const;
export type DcrExpenseCategory = (typeof DCR_EXPENSE_CATEGORIES)[number];
export type DcrExpenseItem = {
  id: string;
  category: DcrExpenseCategory | '';
  amount: string;
  note: string;
};
export type Places = { fromPlace: string; toPlace: string };

const TAG = /^\[Route\] (.*?) -> (.*?)(?:\n|$)/;

/** Adds places to outgoing details (assumed fields when the flag is on, else a remarks tag). */
export function withPlaces(details: DcrDetails, p: Places): DcrDetails {
  if (details.kind !== 'meeting' && details.kind !== 'training' && details.kind !== 'office')
    return details;
  const from = p.fromPlace.trim();
  const to = p.toPlace.trim();
  if (!from && !to) return details;
  if (DCR_V2_FIELDS)
    return { ...details, fromPlace: from || null, toPlace: to || null } as unknown as DcrDetails;
  const rest = details.remarks?.trim() ?? '';
  const remarks = `[Route] ${from} -> ${to}${rest ? `\n${rest}` : ''}`.slice(0, 1000);
  return { ...details, remarks };
}

/** Places + the user's own remarks (tag stripped) from saved details. */
export function readPlaces(details: DcrDetails | null | undefined): Places & { remarks: string } {
  const d = (details ?? {}) as {
    fromPlace?: string | null;
    toPlace?: string | null;
    remarks?: string | null;
  };
  const remarks = d.remarks ?? '';
  if (d.fromPlace || d.toPlace)
    return { fromPlace: d.fromPlace ?? '', toPlace: d.toPlace ?? '', remarks };
  const m = TAG.exec(remarks);
  if (!m) return { fromPlace: '', toPlace: '', remarks };
  return { fromPlace: m[1] ?? '', toPlace: m[2] ?? '', remarks: remarks.slice(m[0].length) };
}

export const expenseAmount = (v: string) => {
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
export const sendableExpenses = (items: DcrExpenseItem[]) =>
  items.filter((i) => i.category && expenseAmount(i.amount));

/** Extra submit-body fields (flag on only). */
export const expenseBodyExtras = (items: DcrExpenseItem[]) =>
  DCR_V2_FIELDS
    ? {
        expenses: sendableExpenses(items).map((i) => ({
          category: i.category,
          amount: expenseAmount(i.amount)!,
          note: i.note.trim() || null,
        })),
      }
    : {};

export type ExpenseOutcome = { claimId: string; total: number; count: number } | null;

/**
 * Server-side outcome only (assumed names expenseClaimId / expenseTotal / expenseCount).
 * The app never creates claim lines itself: the server links DCR expenses idempotently on submit.
 */
export function expenseOutcome(dcr: object | null | undefined): ExpenseOutcome {
  if (!DCR_V2_FIELDS || !dcr) return null;
  const d = dcr as { expenseClaimId?: unknown; expenseTotal?: unknown; expenseCount?: unknown };
  if (typeof d.expenseClaimId !== 'string' || !d.expenseClaimId) return null;
  return {
    claimId: d.expenseClaimId,
    total: Number(d.expenseTotal ?? 0),
    count: Number(d.expenseCount ?? 0),
  };
}
