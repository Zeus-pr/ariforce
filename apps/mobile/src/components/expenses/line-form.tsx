import type { ExpenseCategory } from '@ariforce/contracts';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Field, dcrStyles } from '@/components/dcr/field';
import { SelectSheet } from '@/components/masters/select-sheet';
import { TextField } from '@/components/text-field';
import { dateLabel } from '@/lib/dcr/dates';
import { CATEGORY_LABEL, type Line, type LineInput } from '@/lib/expenses';
import { sortByLabel } from '@/lib/sort';
import { spacing } from '@/theme';

const CATEGORIES = sortByLabel(
  (Object.keys(CATEGORY_LABEL) as ExpenseCategory[])
    .filter((c) => c !== 'allowance') // TA/DA comes from the DCR (auto lines), as on web
    .map((c) => ({ value: c, label: CATEGORY_LABEL[c] })),
);

/** Add or edit one expense line (web line-dialog): date, category, amount, km for mileage, notes. */
export function LineForm({
  dates,
  line,
  initialDate,
  busy,
  error,
  dcrIdFor,
  onSave,
  onCancel,
}: {
  dates: string[];
  line?: Line;
  initialDate?: string;
  busy: boolean;
  error?: string | null;
  dcrIdFor: (date: string) => string | null;
  onSave: (body: LineInput) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(line?.date ?? initialDate ?? dates[dates.length - 1] ?? '');
  const [category, setCategory] = useState<ExpenseCategory | ''>(line?.category ?? '');
  const [amount, setAmount] = useState(line ? String(line.amount) : '');
  const [km, setKm] = useState(line?.mileageKm != null ? String(line.mileageKm) : '');
  const [notes, setNotes] = useState(line?.notes ?? '');
  const [sheet, setSheet] = useState<null | 'date' | 'cat'>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = () => {
    const amt = Number(amount);
    if (!date) return setErr('Choose the date.');
    if (!category) return setErr('Choose the category.');
    if (!(amt > 0)) return setErr('Enter an amount above ₹0.');
    const k = km.trim() ? Number(km) : null;
    if (category === 'mileage' && !(k && k > 0)) return setErr('Enter the kilometres.');
    setErr(null);
    onSave({
      date,
      category,
      amount: Math.round(amt * 100) / 100,
      notes: notes.trim() || null,
      mileageKm: category === 'mileage' ? k : null,
      dcrId: line?.dcrId ?? dcrIdFor(date),
      tourPlanId: line?.tourPlanId ?? null,
    });
  };

  return (
    <Card style={styles.pad}>
      <AppText variant="label">{line ? 'Edit line' : 'Add line'}</AppText>
      <Field
        label="Date"
        value={date ? dateLabel(date) : undefined}
        placeholder="Choose date"
        onPress={() => setSheet('date')}
      />
      <Field
        label="Category"
        value={category ? CATEGORY_LABEL[category] : undefined}
        placeholder="Choose category"
        onPress={() => setSheet('cat')}
      />
      <TextField
        label="Amount (₹)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
      />
      {category === 'mileage' ? (
        <TextField label="Kilometres" value={km} onChangeText={setKm} keyboardType="decimal-pad" />
      ) : null}
      <TextField label="Notes" value={notes} onChangeText={setNotes} maxLength={500} multiline />
      {err || error ? (
        <AppText variant="caption" style={dcrStyles.err}>
          {err || error}
        </AppText>
      ) : null}
      <View style={styles.row}>
        <Button label="Cancel" variant="secondary" compact onPress={onCancel} style={styles.flex} />
        <Button
          label="Save line"
          compact
          loading={busy}
          loadingLabel="Saving…"
          onPress={save}
          style={styles.flex}
        />
      </View>
      <SelectSheet
        visible={sheet === 'date'}
        title="Date"
        options={[...dates].reverse().map((d) => ({ value: d, label: dateLabel(d) }))}
        value={date || null}
        onPick={(v) => v && setDate(v)}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'cat'}
        title="Category"
        options={CATEGORIES}
        value={category || null}
        onPick={(v) => v && setCategory(v as ExpenseCategory)}
        onClose={() => setSheet(null)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
});
