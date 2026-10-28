import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { AppText } from './app-text';
import { colors, motion, radius, spacing, touch } from '@/theme';

const variants = {
  primary: {
    bg: colors.navy,
    bgPressed: colors.navyPressed,
    fg: colors.onNavy,
    border: 'transparent',
  },
  secondary: {
    bg: colors.surface,
    bgPressed: colors.ground,
    fg: colors.navy,
    border: colors.borderStrong,
  },
  tint: {
    bg: colors.infoWash,
    bgPressed: colors.infoWashPressed,
    fg: colors.info,
    border: 'transparent',
  },
} as const;

type Props = {
  label: string;
  onPress: () => void;
  variant?: keyof typeof variants;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  /** compact: 48dp tall, sized to its label (inline in a card). Default: 52dp. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Full-width button. Press feedback on press-in: scale 0.97 + darker fill, as a Reanimated CSS
 * transition (120ms strong ease-out). Loading keeps the label readable ("Signing in…") next to a
 * small spinner, and the accessibility label stays the action name.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  loading,
  loadingLabel,
  disabled,
  compact,
  style,
}: Props) {
  const reduced = useReducedMotion();
  const v = variants[variant];
  const inactive = !!(disabled || loading);

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      pressRetentionOffset={16}
      style={style}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.base,
            compact && styles.compact,
            {
              backgroundColor: pressed ? v.bgPressed : v.bg,
              borderColor: v.border,
              opacity: disabled && !loading ? 0.5 : 1,
              transform: [{ scale: pressed && !reduced ? 0.97 : 1 }],
              transitionProperty: ['transform', 'backgroundColor'],
              transitionDuration: motion.press,
              transitionTimingFunction: motion.cssEaseOut,
            },
          ]}
        >
          <View style={styles.content}>
            {loading && <ActivityIndicator size="small" color={v.fg} />}
            <AppText variant="button" style={{ color: v.fg }}>
              {loading ? (loadingLabel ?? label) : label}
            </AppText>
          </View>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.control,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { minHeight: touch.min, paddingHorizontal: spacing.lg },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
