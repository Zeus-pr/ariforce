import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import {
  format12ToHHmm,
  formatHHmmLabel,
  parseHHmmTo12,
  type AmPm,
  type Clock12,
} from '@/lib/clock12';
import { colors, layout, radius, spacing, touch } from '@/theme';

function stepHour(clock: Clock12, delta: number): Clock12 {
  let hour12 = clock.hour12 + delta;
  if (hour12 > 12) hour12 = 1;
  if (hour12 < 1) hour12 = 12;
  return { ...clock, hour12 };
}

function stepMinute(clock: Clock12, delta: number): Clock12 {
  let minute = clock.minute + delta * 5;
  if (minute >= 60) minute = 0;
  if (minute < 0) minute = 55;
  return { ...clock, minute };
}

/** Fallback when native DateTimePicker is not in this binary (CUTLY Time12WheelSheet). */
export function TimeWheelSheet({
  visible,
  label,
  value,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  label: string;
  value: string;
  onConfirm: (hhmm: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => parseHHmmTo12(value || '09:00'));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={() => setDraft(parseHHmmTo12(value || '09:00'))}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <AppText variant="section">{label}</AppText>
          <AppText variant="name" style={styles.preview}>
            {formatHHmmLabel(format12ToHHmm(draft.hour12, draft.minute, draft.period))}
          </AppText>

          <View style={styles.row}>
            <AppText variant="label" style={styles.rowLabel}>
              Hour
            </AppText>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => setDraft((c) => stepHour(c, -1))}
                style={styles.stepBtn}
                accessibilityRole="button"
                accessibilityLabel="Hour down"
              >
                <AppText variant="body">−</AppText>
              </Pressable>
              <AppText variant="body" style={styles.stepValue}>
                {draft.hour12}
              </AppText>
              <Pressable
                onPress={() => setDraft((c) => stepHour(c, 1))}
                style={styles.stepBtn}
                accessibilityRole="button"
                accessibilityLabel="Hour up"
              >
                <AppText variant="body">+</AppText>
              </Pressable>
            </View>
          </View>

          <View style={styles.row}>
            <AppText variant="label" style={styles.rowLabel}>
              Minute
            </AppText>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => setDraft((c) => stepMinute(c, -1))}
                style={styles.stepBtn}
                accessibilityRole="button"
                accessibilityLabel="Minute down"
              >
                <AppText variant="body">−</AppText>
              </Pressable>
              <AppText variant="body" style={styles.stepValue}>
                {String(draft.minute).padStart(2, '0')}
              </AppText>
              <Pressable
                onPress={() => setDraft((c) => stepMinute(c, 1))}
                style={styles.stepBtn}
                accessibilityRole="button"
                accessibilityLabel="Minute up"
              >
                <AppText variant="body">+</AppText>
              </Pressable>
            </View>
          </View>

          <View style={styles.row}>
            <AppText variant="label" style={styles.rowLabel}>
              Period
            </AppText>
            <View style={styles.ampm}>
              {(['AM', 'PM'] as AmPm[]).map((period) => (
                <Pressable
                  key={period}
                  onPress={() => setDraft((c) => ({ ...c, period }))}
                  style={[styles.ampmBtn, draft.period === period && styles.ampmBtnOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: draft.period === period }}
                >
                  <AppText
                    variant="action"
                    style={draft.period === period ? styles.ampmTextOn : undefined}
                  >
                    {period}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>

          <Button
            label="Done"
            onPress={() => {
              onConfirm(format12ToHHmm(draft.hour12, draft.minute, draft.period));
              onClose();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 42, 74, 0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.ground,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderCurve: 'continuous',
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  preview: { color: colors.navy },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: { width: 72 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
    justifyContent: 'flex-end',
  },
  stepBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { minWidth: 48, textAlign: 'center' },
  ampm: { flexDirection: 'row', gap: spacing.sm, flex: 1, justifyContent: 'flex-end' },
  ampmBtn: {
    paddingHorizontal: spacing.lg,
    minHeight: touch.min,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ampmBtnOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  ampmTextOn: { color: colors.onNavy },
});
