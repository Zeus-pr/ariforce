/**
 * Full-screen guided expense flow (mirrors web PR #94 expense-flow):
 * 1. type + date (today), 2. amount / km / notes + camera-first receipt, 3. review -> Save draft
 * or Submit month. The month's claim is opened or created silently; the day's DCR is linked.
 */
import type { Dcr, ExpenseCategory } from '@ariforce/contracts';
import { ExpenseLineInput } from '@ariforce/contracts';
import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { TextField } from '@/components/text-field';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { apiFetch } from '@/lib/api';
import type { Page } from '@/lib/dcr/api';
import { dateLabel, todayIST } from '@/lib/dcr/dates';
import {
  CATEGORY_LABEL,
  checkFile,
  ensureClaim,
  expenseMessage,
  isEditable,
  monthOf,
  uploadReceipt,
  useClaim,
  useLineMutations,
  type Line,
  type LineInput,
} from '@/lib/expenses';
import { pickDocument, pickPhoto, type PickedFile } from '@/lib/file-pickers';
import { formatINR } from '@/lib/money';
import { colors, fonts, radius, spacing } from '@/theme';

const TYPES = Object.keys(CATEGORY_LABEL) as ExpenseCategory[];
const STEPS = ['Type', 'Details', 'Review'] as const;

function shiftDay(ymd: string, d: number) {
  const t = new Date(`${ymd}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

export default function NewExpense() {
  const { claimId, lineId } = useLocalSearchParams<{ claimId?: string; lineId?: string }>();
  const existing = useClaim(claimId);
  const line = existing.data?.lines.find((l) => l.id === lineId);
  const today = todayIST();
  const bottom = useBottomSpace();

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<ExpenseCategory | null>(line?.category ?? null);
  const [date, setDate] = useState(line?.date ?? today);
  const [amount, setAmount] = useState(line ? String(line.amount) : '');
  const [km, setKm] = useState(line?.mileageKm != null ? String(line.mileageKm) : '');
  const [notes, setNotes] = useState(line?.notes ?? '');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | 'draft' | 'submit'>(null);
  const [seeded, setSeeded] = useState(!lineId);

  // Editing: seed once the claim loads.
  if (!seeded && line) {
    setSeeded(true);
    setCategory(line.category);
    setDate(line.date);
    setAmount(String(line.amount));
    setKm(line.mileageKm != null ? String(line.mileageKm) : '');
    setNotes(line.notes ?? '');
  }

  const dcr = useQuery({
    queryKey: ['dcrs', 'day', date],
    queryFn: ({ signal }) =>
      apiFetch<Page<Dcr>>('/v1/dcrs', { signal, query: { from: date, to: date, limit: 5 } }).then(
        (r) => r.items.find((d) => d.status !== 'draft') ?? r.items[0] ?? null,
      ),
  });

  const body = useMemo((): LineInput | null => {
    if (!category) return null;
    const amt = Math.round(Number(amount) * 100) / 100;
    return {
      date,
      category,
      amount: amt,
      notes: notes.trim() || null,
      mileageKm: category === 'mileage' && km.trim() ? Number(km) : null,
      dcrId: line?.dcrId ?? dcr.data?.id ?? null,
      tourPlanId: line?.tourPlanId ?? null,
    };
  }, [category, amount, date, notes, km, dcr.data, line]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!body) e.category = 'Choose a type.';
    else {
      if (!(body.amount > 0)) e.amount = 'Enter an amount above ₹0.';
      const r = ExpenseLineInput.safeParse(body);
      if (!r.success)
        for (const i of r.error.issues) {
          const k = String(i.path[0] ?? 'amount');
          e[k] ??= k === 'mileageKm' ? 'Enter the kilometres.' : i.message;
        }
    }
    if (date > today) e.date = 'The date cannot be in the future.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Claim id for mutations is resolved at save time (silent open/create).
  const [resolvedId, setResolvedId] = useState<string | undefined>(claimId);
  const muts = useLineMutations(resolvedId ?? '');

  const finish = async (submit: boolean) => {
    if (!body || !validate()) return;
    setBusy(submit ? 'submit' : 'draft');
    try {
      const claim =
        claimId && existing.data && monthOf(date) === existing.data.month
          ? existing.data
          : await ensureClaim(monthOf(date));
      if (!isEditable(claim.status)) {
        Alert.alert('Month locked', 'This month is already submitted.');
        return;
      }
      setResolvedId(claim.id);
      const saved = line
        ? await apiFetch<Line>(`/v1/expense-claims/${claim.id}/lines/${line.id}`, {
            method: 'PUT',
            body: { line: body, version: line.version },
          })
        : await apiFetch<Line>(`/v1/expense-claims/${claim.id}/lines`, { method: 'POST', body });
      const newLineId = saved.id;
      for (const f of files) await uploadReceipt(claim.id, newLineId, f);
      if (submit)
        await apiFetch(`/v1/expense-claims/${claim.id}/submit`, { method: 'POST', body: {} });
      muts.refresh();
      router.replace(`/expenses/${claim.id}`);
    } catch (e) {
      Alert.alert('Could not save', expenseMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const addFile = async (camera: boolean | 'doc') => {
    const f = camera === 'doc' ? await pickDocument() : await pickPhoto(camera);
    if (!f) return;
    const err = checkFile(f, files.length + (line?.attachments.length ?? 0));
    if (err) return Alert.alert('Receipt', err);
    setFiles((x) => [...x, f]);
  };

  const next = () => {
    if (step === 0) {
      if (!category) return setErrors({ category: 'Choose a type.' });
      if (date > today) return setErrors({ date: 'The date cannot be in the future.' });
      setErrors({});
      return setStep(1);
    }
    if (step === 1 && validate()) setStep(2);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: line ? 'Edit expense' : 'New expense' }} />
      <View style={styles.steps}>
        {STEPS.map((s, i) => (
          <View key={s} style={styles.stepItem}>
            <View style={[styles.bar, i <= step && styles.barOn]} />
            <AppText variant="small" style={i === step ? styles.stepOn : undefined}>
              {i + 1}. {s}
            </AppText>
          </View>
        ))}
      </View>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        {step === 0 ? (
          <>
            <AppText variant="label">What did you spend on?</AppText>
            <View style={styles.tiles}>
              {TYPES.map((t) => (
                <Pressable
                  key={t}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === t }}
                  onPress={() => setCategory(t)}
                  style={[styles.tile, category === t && styles.tileOn]}
                >
                  <AppText variant="label" style={category === t ? styles.tileTextOn : undefined}>
                    {CATEGORY_LABEL[t]}
                  </AppText>
                </Pressable>
              ))}
            </View>
            {errors.category ? <AppText style={styles.err}>{errors.category}</AppText> : null}
            <AppText variant="label">Date</AppText>
            <View style={styles.dateRow}>
              <Button
                label="‹"
                variant="secondary"
                compact
                onPress={() => setDate(shiftDay(date, -1))}
              />
              <AppText variant="body" style={styles.dateText}>
                {date === today ? `Today, ${dateLabel(date)}` : dateLabel(date)}
              </AppText>
              <Button
                label="›"
                variant="secondary"
                compact
                disabled={date >= today}
                onPress={() => setDate(shiftDay(date, 1))}
              />
            </View>
            {errors.date ? <AppText style={styles.err}>{errors.date}</AppText> : null}
            {dcr.data ? <AppText variant="small">DCR linked ({dcr.data.status})</AppText> : null}
          </>
        ) : null}
        {step === 1 ? (
          <>
            <TextField
              label="Amount (₹)"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              error={errors.amount}
            />
            {category === 'mileage' ? (
              <TextField
                label="Kilometres"
                keyboardType="decimal-pad"
                value={km}
                onChangeText={setKm}
                error={errors.mileageKm}
              />
            ) : null}
            <TextField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              multiline
              error={errors.notes}
            />
            <AppText variant="label">Receipt</AppText>
            <Button label="Take photo" onPress={() => addFile(true)} />
            <View style={styles.row}>
              <Button label="Gallery" variant="secondary" compact onPress={() => addFile(false)} />
              <Button label="File" variant="secondary" compact onPress={() => addFile('doc')} />
            </View>
            {files.map((f, i) => (
              <View key={`${f.uri}-${i}`} style={styles.fileRow}>
                <AppText variant="caption" style={styles.flex} numberOfLines={1}>
                  {f.name}
                </AppText>
                <Button
                  label="Remove"
                  variant="tint"
                  compact
                  onPress={() => setFiles((x) => x.filter((_, j) => j !== i))}
                />
              </View>
            ))}
          </>
        ) : null}
        {step === 2 && body ? (
          <Card style={styles.review}>
            <Review k="Type" v={CATEGORY_LABEL[body.category]} />
            <Review k="Date" v={dateLabel(body.date)} />
            <Review k="Amount" v={formatINR(body.amount)} />
            {body.mileageKm ? <Review k="Kilometres" v={`${body.mileageKm} km`} /> : null}
            {body.notes ? <Review k="Notes" v={body.notes} /> : null}
            <Review k="Receipts" v={String(files.length + (line?.attachments.length ?? 0))} />
          </Card>
        ) : null}
      </KeyboardAwareScrollView>
      <View style={[styles.footer, { paddingBottom: bottom + spacing.sm }]}>
        {step > 0 ? (
          <Button
            label="Back"
            variant="secondary"
            onPress={() => setStep(step - 1)}
            style={styles.flex}
          />
        ) : null}
        {step < 2 ? (
          <Button label="Next" onPress={next} style={styles.flex} />
        ) : (
          <>
            <Button
              label="Save draft"
              variant="secondary"
              loading={busy === 'draft'}
              disabled={!!busy}
              onPress={() => finish(false)}
              style={styles.flex}
            />
            <Button
              label="Submit month"
              loading={busy === 'submit'}
              disabled={!!busy}
              onPress={() => finish(true)}
              style={styles.flex}
            />
          </>
        )}
      </View>
    </View>
  );
}

function Review({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.reviewRow}>
      <AppText variant="bodyMuted">{k}</AppText>
      <AppText variant="body" style={styles.reviewV}>
        {v}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  steps: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: 0 },
  stepItem: { flex: 1, gap: spacing.xs },
  bar: { height: 4, borderRadius: radius.full, backgroundColor: colors.separator },
  barOn: { backgroundColor: colors.brandTeal },
  stepOn: { color: colors.brandNavyCore, fontFamily: fonts.semibold },
  content: { padding: spacing.lg, gap: spacing.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '48%',
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  tileOn: { borderColor: colors.brandNavyCore, backgroundColor: colors.brandNavyWash },
  tileTextOn: { color: colors.brandNavyCore },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dateText: { flex: 1, textAlign: 'center' },
  err: { color: colors.danger },
  row: { flexDirection: 'row', gap: spacing.sm },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  review: { padding: spacing.lg, gap: spacing.sm },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  reviewV: { flex: 1, textAlign: 'right' },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
});
