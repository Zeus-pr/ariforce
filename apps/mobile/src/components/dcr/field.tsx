import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { colors, fonts, radius, spacing, touch, type } from '@/theme';

/** Labelled tap-to-choose box (opens a sheet). Read-only when there is no onPress. */
export function Field({
  label,
  value,
  placeholder,
  onPress,
  error,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  onPress?: () => void;
  error?: string;
}) {
  return (
    <View style={dcrStyles.field}>
      <AppText variant="label">{label}</AppText>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={[dcrStyles.select, !!error && dcrStyles.selectErr]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || placeholder || 'none'}`}
        accessibilityHint={error}
      >
        <AppText
          variant="body"
          numberOfLines={2}
          style={[dcrStyles.selectText, !value && dcrStyles.ph]}
        >
          {value || placeholder || '—'}
        </AppText>
        {onPress ? <Icon name="chevron-down" color={colors.subtle} /> : null}
      </Pressable>
      {error ? (
        <AppText variant="caption" style={dcrStyles.err}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/** Inline error lines under a section. */
export function Errors({ list }: { list: string[] }) {
  return (
    <>
      {list.map((m) => (
        <AppText key={m} variant="caption" style={dcrStyles.err}>
          {m}
        </AppText>
      ))}
    </>
  );
}

/** Styles shared by the DCR form sections. */
export const dcrStyles = StyleSheet.create({
  field: { gap: spacing.sm },
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
  selectText: { flex: 1, fontFamily: fonts.regular, fontSize: type.body.fontSize },
  ph: { color: colors.subtle },
  err: { color: colors.danger },
  section: { gap: spacing.md },
});
