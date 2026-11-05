import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { Icon, type IconName } from './icon';
import { PressableScale } from './pressable-scale';
import { TintedIcon } from './tinted-icon';
import { colors, sizes, spacing, type Tone } from '@/theme';

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

/**
 * One row inside a grouped card. Every row is the same height (sizes.row) and shows one line of
 * title and one of subtitle, so rows never differ by content. Tappable rows get press scale + fill.
 */
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
        <AppText variant="rowTitle" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
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
    <PressableScale
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      containerStyle={divider ? styles.divider : undefined}
      style={styles.row}
      pressedStyle={styles.pressed}
    >
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  // Pills sit centred on the title row, right-aligned, never squeezed or wrapped.
  trailing: { flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center' },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  pressed: { backgroundColor: colors.ground },
  text: { flex: 1 },
});
