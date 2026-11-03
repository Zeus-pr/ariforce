/**
 * Expenses on a DCR (any work type), built to Architect's contract PR #121 (feat/dcr-tp-contract):
 * `DcrDraftPut.expenses` / `Dcr.expenses` = DcrExpenseItem[] (max 20) and
 * `DcrSubmitResult.dcrExpenses` = DcrExpenseLink. These types mirror that PR until it merges; then
 * swap them for the @ariforce/contracts exports.
 */
import type { ExpenseCategory } from '@ariforce/contracts';
import { CATEGORY_LABEL } from '@/lib/expenses/model';

/** The expense categories a DCR may use (allowance and mileage stay with TA/DA). */
export const DCR_EXPENSE_CATEGORIES = [
  'travel',
  'hotel',
  'food',
  'other',
] as const satisfies readonly ExpenseCategory[];
export type DcrExpenseCategory = (typeof DCR_EXPENSE_CATEGORIES)[number];
export const DCR_EXPENSE_MAX_ITEMS = 20;

export type DcrExpenseItem = {
  id: string;
  category: DcrExpenseCategory;
  amount: number;
  note?: string | null;
  receiptRef?: string | null;
};

export type DcrExpenseLink = {
  status: 'linked' | 'skipped' | 'error';
  reason: 'claim_locked' | 'no_expenses' | null;
  claimId: string | null;
  claimStatus: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid' | null;
  claimCreated: boolean;
  lines: number;
  total: number;
};

/** One row on the form; amount stays text while typing. */
export type ExpenseDraft = {
  id: string;
  category: DcrExpenseCategory;
  amount: string;
  note: string;
};

export const categoryLabel = (c: string) =>
  CATEGORY_LABEL[c as ExpenseCategory] ?? c.charAt(0).toUpperCase() + c.slice(1);

const isCat = (c: unknown): c is DcrExpenseCategory =>
  (DCR_EXPENSE_CATEGORIES as readonly unknown[]).includes(c);

/** Rupees with at most 2 decimals, above zero. */
export function amountOf(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

export const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Saved items (absent on older APIs = none). */
export function expensesOf(d: unknown): DcrExpenseItem[] {
  const list = (d as { expenses?: unknown } | null)?.expenses;
  return Array.isArray(list) ? (list as DcrExpenseItem[]) : [];
}

export const draftsOf = (items: DcrExpenseItem[]): ExpenseDraft[] =>
  items.map((e) => ({
    id: e.id,
    category: isCat(e.category) ? e.category : 'other',
    amount: String(e.amount),
    note: e.note ?? '',
  }));

/** Rows ready to send; a row with an invalid amount is left out (problems() blocks submit). */
export const itemsOf = (rows: ExpenseDraft[]): DcrExpenseItem[] =>
  rows.flatMap((r) => {
    const amount = amountOf(r.amount);
    return amount ? [{ id: r.id, category: r.category, amount, note: r.note.trim() || null }] : [];
  });

export function expenseProblems(rows: ExpenseDraft[]): string | null {
  const bad = rows.filter((r) => !amountOf(r.amount)).length;
  if (!bad) return null;
  return bad === 1
    ? 'Enter an amount for the expense, or remove it.'
    : `Enter an amount for ${bad} expenses, or remove them.`;
}

/* Smart default category: the last one used for this work type, else the most used one. */
const KEY = 'af:dcr-expense-categories';
type Memory = { last: Record<string, DcrExpenseCategory>; count: Record<string, number> };
function read(): Memory {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '') as Memory;
    if (m && typeof m === 'object' && m.last && m.count) return m;
  } catch {
    /* nothing saved yet */
  }
  return { last: {}, count: {} };
}

export function defaultCategory(workTypeId: string): DcrExpenseCategory {
  if (typeof window === 'undefined') return 'travel';
  const m = read();
  const last = m.last[workTypeId];
  if (isCat(last)) return last;
  const top = DCR_EXPENSE_CATEGORIES.reduce((a, c) =>
    (m.count[c] ?? 0) > (m.count[a] ?? 0) ? c : a,
  );
  return (m.count[top] ?? 0) > 0 ? top : 'travel';
}

/** Remember what was submitted, so the next report starts on the likely category. */
export function rememberCategories(workTypeId: string, items: DcrExpenseItem[]) {
  if (!items.length || typeof window === 'undefined') return;
  const m = read();
  for (const i of items) m.count[i.category] = (m.count[i.category] ?? 0) + 1;
  m.last[workTypeId] = items[items.length - 1]!.category;
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage full or blocked: the default just falls back */
  }
}

/** The small outcome line after submit. Null when there was nothing to add. */
export function linkOutcome(items: DcrExpenseItem[], link: DcrExpenseLink | null | undefined) {
  if (!items.length) return null;
  const total = money(items.reduce((t, i) => t + i.amount, 0));
  const what = `${items.length === 1 ? '1 expense' : `${items.length} expenses`} (${total})`;
  if (link?.status === 'skipped' && link.reason === 'claim_locked')
    return `${what} stay on this report. This month's claim is already submitted, so they were not added to it.`;
  if (link?.status === 'error')
    return `${what} could not be added to your expense claim yet. They are saved on this report.`;
  return `${what} will be added to your expense claim.`;
}
