import { DCR_EXPENSE_CATEGORIES, type DcrExpenseItem } from '@ariforce/contracts';
import { err } from '../field/checkins.service';

/**
 * DCR expense items (draft PUT and submit body). The shape is checked by zod; categories must be
 * one of DCR_EXPENSE_CATEGORIES (allowance and mileage stay with the TA/DA engine). Amounts are
 * rounded to paise. Returns a clean copy (unknown keys were already stripped by zod).
 */
export function checkDcrExpenses(items: readonly DcrExpenseItem[], field = 'expenses') {
  const allowed: readonly string[] = DCR_EXPENSE_CATEGORIES;
  return items.map((e, index) => {
    if (!allowed.includes(e.category))
      throw err(422, 'DCR_EXPENSE_CATEGORY_INVALID', `Category '${e.category}' is not allowed`, {
        field: `${field}.${index}.category`,
        index,
        allowed: DCR_EXPENSE_CATEGORIES,
      });
    const out: DcrExpenseItem = { category: e.category, amount: Math.round(e.amount * 100) / 100 };
    if (e.note != null) out.note = e.note;
    return out;
  });
}
