import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AppText } from './app-text';
import { Icon, type IconName } from './icon';
import { TintedIcon } from './tinted-icon';
import { colors, spacing, touch, type Tone } from '@/theme';

type Props = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  tone?: Tone;
  /** Right-hand content (chip, value); a chevron is added when the row is tappable. */
  trailing?: ReactNode;
  onPress?: () => void;
  divider?: boolean;
  accessibilityLabel?: string;
};

/** One row inside a grouped card. Tappable rows get a pressed fill (no scale inside lists). */
export function ListRow({
  title,
  subtitle,
  icon,
  tone = 'neutral',
  trailing,
  onPress,
  divider,
  accessibilityLabel,
}: Props) {
  const body = (
    <>
      {icon ? <TintedIcon name={icon} tone={tone} /> : null}
      <View style={styles.text}>
        <AppText variant="rowTitle" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
      {onPress ? <Icon name="chevron-right" color={colors.subtle} /> : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[styles.row, divider && styles.divider]}
        accessible
        accessibilityLabel={accessibilityLabel}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.min + spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  pressed: { backgroundColor: colors.ground },
  text: { flex: 1 },
});
