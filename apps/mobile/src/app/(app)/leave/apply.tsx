import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Field, dcrStyles } from '@/components/dcr/field';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { SelectSheet } from '@/components/masters/select-sheet';
import { PressableScale } from '@/components/pressable-scale';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { SkeletonForm } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { todayIST } from '@/lib/dcr/dates';
import {
  addDays,
  countDays,
  dateLabelL,
  daysLabel,
  leaveMessage,
  useApplyLeave,
  useLeaveData,
} from '@/lib/leave';
import { layout, spacing } from '@/theme';

/** Apply for leave (web apply-dialog): type, from/to, half day when the type allows it, reason. */
export default function ApplyLeaveScreen() {
  const router = useRouter();
  const bottom = useBottomSpace();
  const q = useLeaveData();
  const apply = useApplyLeave();
  const today = todayIST();
  const [typeCode, setTypeCode] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [half, setHalf] = useState<'am' | 'pm' | null>(null);
  const [reason, setReason] = useState('');
  const [sheet, setSheet] = useState<null | 'type' | 'from' | 'to'>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = q.data?.settings;
  const type = q.data?.types.find((t) => t.code === typeCode);
  const bal = q.data?.balances.find((b) => b.typeCode === typeCode);
  // Backdating window and future limit from leave settings; the server checks again.
  const dates = useMemo(() => {
    const back = settings?.backdateDays ?? 14;
    const ahead = settings?.maxFutureDays ?? 120;
    return Array.from({ length: back + ahead + 1 }, (_, i) => addDays(today, i - back)).map(
      (v) => ({ value: v, label: dateLabelL(v), hint: v === today ? 'Today' : undefined }),
    );
  }, [settings, today]);
  const days = countDays(from, to, half, settings?.weeklyOffDays ?? [0]);
  const canHalf = !!type?.halfDayAllowed && from === to;

  async function submit() {
    if (!typeCode) return setError('Choose the leave type.');
    if (to < from) return setError('The end date is before the start date.');
    if (!days) return setError('Every selected date is a weekly off.');
    setError(null);
    try {
      await apply.mutateAsync({
        typeCode,
        fromDate: from,
        toDate: to,
        half: canHalf ? half : null,
        reason: reason.trim() || null,
      });
      Alert.alert('Leave applied', 'Your manager will review it.');
      router.back();
    } catch (e) {
      setError(leaveMessage(e));
    }
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Apply for leave' }} />
      {q.isPending ? (
        <View style={styles.content}>
          <SkeletonForm count={4} />
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          <Field
            label="Leave type"
            value={type?.name}
            placeholder="Choose leave type"
            onPress={() => setSheet('type')}
          />
          {bal ? (
            <AppText variant="small">
              {bal.unlimited ? 'No limit' : `${bal.available ?? 0} days available`}
            </AppText>
          ) : null}
          <Field label="From" value={dateLabelL(from)} onPress={() => setSheet('from')} />
          <Field label="To" value={dateLabelL(to)} onPress={() => setSheet('to')} />
          {canHalf ? (
            <View style={styles.row}>
              {(
                [
                  [null, 'Full day'],
                  ['am', 'Morning'],
                  ['pm', 'Afternoon'],
                ] as const
              ).map(([v, label]) => (
                <PressableScale
                  key={label}
                  onPress={() => setHalf(v)}
                  accessibilityLabel={label}
                  accessibilityState={{ selected: half === v }}
                >
                  <Chip label={label} tone={half === v ? 'teal' : 'neutral'} />
                </PressableScale>
              ))}
            </View>
          ) : null}
          <AppText variant="label">{daysLabel(days)} of leave</AppText>
          <TextField
            label="Reason"
            value={reason}
            onChangeText={setReason}
            maxLength={1000}
            multiline
          />
          {error ? (
            <AppText variant="caption" style={dcrStyles.err}>
              {error}
            </AppText>
          ) : null}
          <Button
            label="Apply"
            loading={apply.isPending}
            loadingLabel="Applying…"
            onPress={() => void submit()}
          />
        </KeyboardAwareScrollView>
      )}
      <SelectSheet
        visible={sheet === 'type'}
        title="Leave type"
        options={(q.data?.types ?? []).map((t) => ({
          value: t.code,
          label: t.name,
          hint: t.paid ? undefined : 'Unpaid',
        }))}
        value={typeCode || null}
        onPick={(v) => v && setTypeCode(v)}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'from'}
        title="From"
        options={dates}
        value={from}
        onPick={(v) => {
          if (!v) return;
          setFrom(v);
          if (to < v) setTo(v);
        }}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'to'}
        title="To"
        options={dates.filter((d) => d.value >= from)}
        value={to}
        onPick={(v) => v && setTo(v)}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
});
