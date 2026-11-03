import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useBottomSpace } from './floating-tab-bar';
import { AppText } from './app-text';
import { Icon, type IconName } from './icon';
import { colors, layout, radius, shadows, spacing, touch } from '@/theme';

/**
 * Floating action pill that clears the tab bar / safe area using `useBottomSpace`
 * (same rule as Tour Plan “New TP”).
 */
export function FloatingFab({
  label,
  onPress,
  accessibilityLabel,
  icon = 'plus',
  tone = 'navy',
  style,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  icon?: IconName;
  tone?: 'navy' | 'canopy';
  style?: StyleProp<ViewStyle>;
}) {
  const bottom = useBottomSpace();
  const bg = tone === 'canopy' ? colors.canopy : colors.navy;
  const pressed = tone === 'canopy' ? colors.canopyDeep : colors.navyPressed;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed: p }) => [
        styles.fab,
        { bottom: bottom + spacing.lg, backgroundColor: bg },
        p && { backgroundColor: pressed },
        style,
      ]}
    >
      <Icon name={icon} color={colors.onNavy} />
      <AppText variant="button" style={styles.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Extra scroll padding so the last row clears the FAB + tab bar. */
export function useFabScrollPad() {
  const bottom = useBottomSpace();
  return bottom + touch.control + spacing.lg;
}

export function FabHost({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: layout.gutter,
    zIndex: 30,
    elevation: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: touch.control,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    boxShadow: shadows.floating,
  },
  text: { color: colors.onNavy },
});
