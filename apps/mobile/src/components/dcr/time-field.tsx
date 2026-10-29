import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { TimeWheelSheet } from '@/components/dcr/time-wheel-sheet';
import { formatHHmmLabel } from '@/lib/clock12';
import { colors, fonts, radius, spacing, touch, type } from '@/theme';

/**
 * Time field storing 24h `HH:mm` for the API, picked on the JS 12-hour wheel sheet
 * (no native date-time picker: the app ships no extra native modules).
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
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <AppText variant="label">
        {label}
        {optional ? <AppText variant="small"> (optional)</AppText> : null}
      </AppText>
      <Pressable
        onPress={() => editable && setOpen(true)}
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
      <TimeWheelSheet
        visible={open}
        label={label}
        value={value || '09:00'}
        onConfirm={onChange}
        onClose={() => setOpen(false)}
      />
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
});
