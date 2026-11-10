import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { SelectSheet } from '@/components/masters/select-sheet';
import { TextField } from '@/components/text-field';
import {
  DCR_EXPENSE_CATEGORIES,
  expenseAmount,
  expenseOutcome,
  sendableExpenses,
  type DcrExpenseItem,
} from '@/lib/dcr/v2-adapter';
import { CATEGORY_LABEL } from '@/lib/expenses';
import { colors, radius, spacing } from '@/theme';
import { dcrStyles, Field } from './field';

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
let seq = 0;
const newItem = (): DcrExpenseItem => ({
  id: `x${Date.now()}${seq++}`,
  category: '',
  amount: '',
  note: '',
});

/** Optional, collapsed by default: category + amount + note rows. */
export function ExpenseItems({
  value,
  readOnly,
  onChange,
}: {
  value: DcrExpenseItem[];
  readOnly: boolean;
  onChange: (v: DcrExpenseItem[]) => void;
}) {
  const [open, setOpen] = useState(value.length > 0);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const ok = sendableExpenses(value);
  const total = ok.reduce((a, i) => a + expenseAmount(i.amount)!, 0);
  const set = (id: string, patch: Partial<DcrExpenseItem>) =>
    onChange(value.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  return (
    <View style={dcrStyles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.head}
      >
        <AppText variant="label" style={styles.flex}>
          Expenses{ok.length ? ` · ${inr(total)}` : ''}
        </AppText>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.navy} />
      </Pressable>
      {open ? (
        <View style={styles.list}>
          {value.map((i) => (
            <View key={i.id} style={styles.item}>
              <Field
                label="Category"
                value={i.category ? CATEGORY_LABEL[i.category] : undefined}
                placeholder="Choose"
                onPress={readOnly ? undefined : () => setPickFor(i.id)}
              />
              <TextField
                label="Amount (₹)"
                value={i.amount}
                onChangeText={(amount) => set(i.id, { amount: amount.replace(/[^\d.]/g, '') })}
                keyboardType="decimal-pad"
                editable={!readOnly}
                error={i.amount && !expenseAmount(i.amount) ? 'Enter an amount.' : undefined}
                maxLength={10}
              />
              <TextField
                label="Note (optional)"
                value={i.note}
                onChangeText={(note) => set(i.id, { note })}
                editable={!readOnly}
                maxLength={300}
              />
              {readOnly ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove expense"
                  onPress={() => onChange(value.filter((x) => x.id !== i.id))}
                  hitSlop={8}
                  style={styles.remove}
                >
                  <Icon name="trash-can-outline" size={18} color={colors.danger} />
                  <AppText variant="action" style={styles.removeText}>
                    Remove
                  </AppText>
                </Pressable>
              )}
            </View>
          ))}
          {readOnly ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={() => onChange([...value, newItem()])}
              style={styles.add}
            >
              <Icon name="plus" size={18} color={colors.navy} />
              <AppText variant="action">Add expense</AppText>
            </Pressable>
          )}
        </View>
      ) : null}
      <SelectSheet
        visible={!!pickFor}
        title="Category"
        options={DCR_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
        value={value.find((i) => i.id === pickFor)?.category || null}
        onPick={(v) => pickFor && v && set(pickFor, { category: v as DcrExpenseItem['category'] })}
        onClose={() => setPickFor(null)}
      />
    </View>
  );
}

/** Read-only "Added to expenses: ₹X (n items)" from the server's outcome only; opens the claim. */
export function DcrExpenseChip({ dcr }: { dcr: object }) {
  const router = useRouter();
  const out = expenseOutcome(dcr);
  if (out?.kind !== 'linked') return null;
  const { claimId: id, total, count } = out;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push({ pathname: '/expenses/[id]', params: { id } })}
      style={styles.chip}
    >
      <AppText variant="small" style={styles.chipText}>
        {`Added to expenses: ${inr(total)} (${count} item${count === 1 ? '' : 's'})`}
      </AppText>
      <Icon name="chevron-right" size={16} color={colors.teal} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center' },
  list: { gap: spacing.md },
  item: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: 44,
  },
  removeText: { color: colors.danger },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: 44,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  chipText: { color: colors.navy },
});
