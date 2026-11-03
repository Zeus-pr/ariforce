'use client';

import { Plus, X } from 'lucide-react';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import {
  amountOf,
  categoryLabel,
  DCR_EXPENSE_CATEGORIES,
  DCR_EXPENSE_MAX_ITEMS,
  money,
  type DcrExpenseCategory,
  type ExpenseDraft,
} from '@/lib/dcr/expenses';

/**
 * Optional day expenses. Collapsed to one quiet "Add expense" row until used; read-only it shows
 * only when there is something to show.
 */
export function DcrExpenses({
  rows,
  onChange,
  readOnly,
  defaultCategory,
  showErrors,
}: {
  rows: ExpenseDraft[];
  onChange: (rows: ExpenseDraft[]) => void;
  readOnly: boolean;
  defaultCategory: () => DcrExpenseCategory;
  showErrors: boolean;
}) {
  const total = rows.reduce((t, r) => t + (amountOf(r.amount) ?? 0), 0);
  if (readOnly) {
    if (!rows.length) return null;
    return (
      <section className="flex flex-col gap-2" data-testid="dcr-expenses">
        <h3 className="text-sm font-medium">Expenses</h3>
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                {categoryLabel(r.category)}
                {r.note && <span className="ml-2 text-muted-foreground">{r.note}</span>}
              </span>
              <span className="tabular-nums">{money(Number(r.amount))}</span>
            </li>
          ))}
          {rows.length > 1 && (
            <li className="flex justify-between px-3 py-2 font-medium">
              <span>Total</span>
              <span className="tabular-nums">{money(total)}</span>
            </li>
          )}
        </ul>
      </section>
    );
  }

  const patch = (id: string, p: Partial<ExpenseDraft>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => {
    const id = crypto.randomUUID();
    onChange([...rows, { id, category: defaultCategory(), amount: '', note: '' }]);
    setTimeout(() => document.getElementById(`exp-amt-${id}`)?.focus(), 30);
  };

  return (
    <section className="flex flex-col gap-2" data-testid="dcr-expenses">
      {rows.length > 0 && <h3 className="text-sm font-medium">Expenses</h3>}
      {rows.map((r, i) => {
        const bad = showErrors && !amountOf(r.amount);
        return (
          <div
            key={r.id}
            className="grid grid-cols-[minmax(0,8rem)_minmax(0,7rem)_1fr_auto] items-start gap-2"
            data-testid="dcr-expense-row"
          >
            <select
              aria-label={`Expense ${i + 1} category`}
              value={r.category}
              onChange={(e) => patch(r.id, { category: e.target.value as DcrExpenseCategory })}
              className="h-11 rounded-md border bg-card px-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
              data-testid="dcr-expense-category"
            >
              {DCR_EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
            <Input
              id={`exp-amt-${r.id}`}
              aria-label={`Expense ${i + 1} amount in rupees`}
              aria-invalid={bad || undefined}
              inputMode="decimal"
              placeholder="₹ 0"
              value={r.amount}
              onChange={(e) => patch(r.id, { amount: e.target.value.replace(/[^\d.]/g, '') })}
              className="h-11 tabular-nums md:text-base"
              data-testid="dcr-expense-amount"
            />
            <Input
              aria-label={`Expense ${i + 1} note`}
              placeholder="Note (optional)"
              maxLength={500}
              value={r.note}
              onChange={(e) => patch(r.id, { note: e.target.value })}
              className="h-11 md:text-base"
              data-testid="dcr-expense-note"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={`Remove expense ${i + 1}`}
              onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
              data-testid="dcr-expense-remove"
            >
              <X aria-hidden />
            </Button>
          </div>
        );
      })}
      {rows.length < DCR_EXPENSE_MAX_ITEMS && (
        <button
          type="button"
          onClick={add}
          className="flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          data-testid="dcr-expense-add"
        >
          <Plus className="size-4" aria-hidden /> Add expense
        </button>
      )}
    </section>
  );
}
