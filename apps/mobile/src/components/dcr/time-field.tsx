import { useMemo, useState, type ComponentType } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { TimeWheelSheet } from '@/components/dcr/time-wheel-sheet';
import { canUseNativeTimePicker } from '@/lib/can-use-native-time-picker';
import { dateFromHHmm, formatHHmmLabel, hhmmFromDate } from '@/lib/clock12';
import { colors, fonts, layout, radius, spacing, touch, type } from '@/theme';

type DateTimePickerEvent = {
  type: 'set' | 'dismissed' | 'neutralButtonPressed';
  nativeEvent: { timestamp?: number; utcOffset?: number };
};

type NativePickerProps = {
  value: Date;
  mode?: 'date' | 'time' | 'datetime' | 'countdown';
  display?: 'default' | 'spinner' | 'clock' | 'calendar';
  is24Hour?: boolean;
  themeVariant?: 'light' | 'dark';
  onChange?: (event: DateTimePickerEvent, date?: Date) => void;
  style?: object;
};

/**
 * Lazy require only after probing the binary (CUTLY Time12Field).
 * A static import crashes Expo Go / stale APKs when RNCDatePicker is missing.
 */
function loadNativePicker(): ComponentType<NativePickerProps> | null {
  if (!canUseNativeTimePicker()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-community/datetimepicker') as {
      default: ComponentType<NativePickerProps>;
    };
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * Time field storing 24h `HH:mm` for the API.
 * Native picker when linked (iOS spinner / Android dialog); otherwise CUTLY wheel sheet.
 */
export function TimeField({
  label,
  value,
  onChange,
  editable = true,
  error,
  optional,
}: {
  label: string;
  value: string;
  onChange: (hhmm: string) => void;
  editable?: boolean;
  error?: string;
  optional?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const NativePicker = useMemo(() => loadNativePicker(), []);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => dateFromHHmm(value || '09:00'));

  const openPicker = () => {
    if (!editable) return;
    setDraft(dateFromHHmm(value || hhmmFromDate(new Date())));
    setOpen(true);
  };

  const apply = (date: Date) => onChange(hhmmFromDate(date));

  const onNativeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setOpen(false);
      if (event.type === 'dismissed' || !selected) return;
      apply(selected);
      return;
    }
    if (selected) setDraft(selected);
  };

  return (
    <View style={styles.wrap}>
      <AppText variant="label">
        {label}
        {optional ? <AppText variant="small"> (optional)</AppText> : null}
      </AppText>
      <Pressable
        onPress={openPicker}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel={`${label}${value ? `: ${formatHHmmLabel(value)}` : ''}`}
        style={[styles.select, !!error && styles.selectErr, !editable && styles.disabled]}
      >
        <AppText variant="body" style={[styles.text, !value && styles.ph]}>
          {value ? formatHHmmLabel(value) : 'Choose time'}
        </AppText>
        {editable ? <Icon name="clock-outline" color={colors.subtle} /> : null}
      </Pressable>
      {error ? (
        <AppText variant="caption" style={styles.err}>
          {error}
        </AppText>
      ) : null}

      {!NativePicker ? (
        <TimeWheelSheet
          visible={open}
          label={label}
          value={value || '09:00'}
          onConfirm={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}

      {NativePicker && open && Platform.OS === 'android' ? (
        <NativePicker
          value={draft}
          mode="time"
          display="default"
          is24Hour={false}
          onChange={onNativeChange}
        />
      ) : null}

      {NativePicker && Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close" />
            <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
              <View style={styles.sheetHead}>
                <AppText variant="section" style={styles.sheetTitle}>
                  {label}
                </AppText>
                <Button
                  label="Done"
                  compact
                  onPress={() => {
                    apply(draft);
                    setOpen(false);
                  }}
                />
              </View>
              <NativePicker
                value={draft}
                mode="time"
                display="spinner"
                themeVariant="light"
                onChange={onNativeChange}
                style={styles.spinner}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.control,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  selectErr: { borderColor: colors.danger },
  disabled: { opacity: 0.7 },
  text: { flex: 1, fontFamily: fonts.regular, fontSize: type.body.fontSize },
  ph: { color: colors.subtle },
  err: { color: colors.danger },
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
    paddingTop: spacing.md,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  sheetTitle: { flex: 1 },
  spinner: { alignSelf: 'stretch', height: 216 },
});
