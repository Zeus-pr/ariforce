import type { DcrDetails } from '@ariforce/contracts';

/**
 * DCR v2 adapter: the ONLY place that knows how end time, places and DCR expenses reach the API.
 * Contract: PR #121 (feat/dcr-tp-contract). Types are mirrored here until #121 is on this base.
 *
 * - Flag on (EXPO_PUBLIC_DCR_V2_FIELDS=1): details.endTime, details.fromPlace/toPlace (meeting and
 *   office only), `expenses[]` on the draft PUT and the submit body; the submit response's
 *   expenseClaimId / expenseTotal / expenseCount / dcrExpenses drive the outcome. The server links
 *   the claim lines (idempotent); the app never creates them.
 * - Flag off (default, until the API is deployed): places ride as a tagged first line of
 *   `remarks`, no endTime is sent, and the Expenses section is hidden.
 */
export const DCR_V2_FIELDS = process.env.EXPO_PUBLIC_DCR_V2_FIELDS === '1';

export const DCR_EXPENSE_MAX_ITEMS = 20;
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

/** Strips a `[Route] …` tag so it can never double up with the real fields. */
const untagged = (remarks: string | null | undefined) => {
  const r = remarks ?? '';
  const m = TAG.exec(r);
  return m ? r.slice(m[0].length) : r;
};

/** v2 contract extras on meeting / training / office details (PR #121). */
type V2Details = { endTime?: string | null; fromPlace?: string | null; toPlace?: string | null };

/**
 * Adds end time and places to outgoing details. Flag on: real `endTime` (meeting, training,
 * office) and `fromPlace`/`toPlace` (meeting, office only). Flag off: places as a remarks tag.
 */
export function withV2(details: DcrDetails, p: Places & { endTime: string }): DcrDetails {
  if (details.kind !== 'meeting' && details.kind !== 'training' && details.kind !== 'office')
    return details;
  const placed = details.kind !== 'training';
  const from = placed ? p.fromPlace.trim() : '';
  const to = placed ? p.toPlace.trim() : '';
  const clean = untagged(details.remarks).trim() || null;
  if (DCR_V2_FIELDS) {
    const extra: V2Details = {
      ...(/^\d\d:\d\d$/.test(p.endTime) && details.startTime ? { endTime: p.endTime } : {}),
      ...(placed ? { fromPlace: from || null, toPlace: to || null } : {}),
    };
    // Server derives durationMin from start/end: don't send it alongside endTime.
    const { durationMin: _d, ...rest } = details as typeof details & { durationMin?: number };
    const base = extra.endTime ? rest : details;
    return { ...base, remarks: clean, ...extra } as DcrDetails;
  }
  if (!from && !to) return { ...details, remarks: clean };
  const rest = clean ?? '';
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
  // Real fields win; any tag is still stripped so remarks never show it twice.
  if (d.fromPlace || d.toPlace)
    return { fromPlace: d.fromPlace ?? '', toPlace: d.toPlace ?? '', remarks: untagged(remarks) };
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

/** `expenses` for the draft PUT and submit body (flag on only; replaces the saved list). */
export const expenseBodyExtras = (
  items: DcrExpenseItem[] | undefined,
): { expenses?: { category: DcrExpenseCategory; amount: number; note: string | null }[] } =>
  DCR_V2_FIELDS
    ? {
        expenses: sendableExpenses(items ?? [])
          .slice(0, DCR_EXPENSE_MAX_ITEMS)
          .map((i) => ({
            category: i.category as DcrExpenseCategory,
            amount: expenseAmount(i.amount)!,
            note: i.note.trim() || null,
          })),
      }
    : {};

/** Saved `Dcr.expenses` back into form rows (draft load). */
export function expensesFromDcr(dcr: object | null | undefined): DcrExpenseItem[] {
  const list = (dcr as { expenses?: unknown } | null)?.expenses;
  if (!DCR_V2_FIELDS || !Array.isArray(list)) return [];
  return list.map((e: { category?: string; amount?: number; note?: string | null }, n) => ({
    id: `s${n}`,
    category: (DCR_EXPENSE_CATEGORIES as readonly string[]).includes(e.category ?? '')
      ? (e.category as DcrExpenseCategory)
      : '',
    amount: e.amount != null ? String(e.amount) : '',
    note: e.note ?? '',
  }));
}

/** Mirrors DcrExpenseLink (PR #121). */
export type DcrExpenseLink = {
  status: 'linked' | 'skipped' | 'error';
  reason: 'claim_locked' | 'no_expenses' | null;
  claimId: string | null;
  lines: number;
  total: number;
};
export type ExpenseOutcome =
  | { kind: 'linked'; claimId: string; total: number; count: number }
  | { kind: 'locked' }
  | { kind: 'error' }
  | null;

/** Outcome from the submit response or a Dcr read (#121 839e56a) (server links the lines; never the app). */
export function expenseOutcome(res: object | null | undefined): ExpenseOutcome {
  if (!DCR_V2_FIELDS || !res) return null;
  const r = res as {
    expenseClaimId?: string | null;
    expenseTotal?: number | null;
    expenseCount?: number | null;
    dcrExpenses?: DcrExpenseLink | null;
  };
  const link = r.dcrExpenses;
  if (link?.status === 'error') return { kind: 'error' };
  if (link?.status === 'skipped') return link.reason === 'claim_locked' ? { kind: 'locked' } : null;
  const claimId = r.expenseClaimId ?? link?.claimId ?? null;
  const count = Number(r.expenseCount ?? link?.lines ?? 0);
  if (!claimId || !(count > 0)) return null;
  return { kind: 'linked', claimId, total: Number(r.expenseTotal ?? link?.total ?? 0), count };
}

/** One line for the submit alert (null = say nothing). */
export function expenseOutcomeText(o: ExpenseOutcome): string | null {
  if (!o) return null;
  if (o.kind === 'linked')
    return `Added to expenses: ₹${o.total.toLocaleString('en-IN')} (${o.count} item${o.count === 1 ? '' : 's'})`;
  if (o.kind === 'locked')
    return 'This month’s claim is already sent, so your expenses stay on this report.';
  return 'Your expenses are saved on this report. They could not be added to your claim just now; check Expenses later.';
}
