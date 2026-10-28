import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, EASE_OUT, fonts, radius } from '@/theme';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
};

const ease = Easing.bezier(...EASE_OUT);

/** Full-width button; scales to 0.97 on press, shows a spinner while loading. */
export function Button({
  label,
  onPress,
  loading,
  loadingLabel,
  disabled,
  variant = 'primary',
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.timing(scale, {
      toValue: v,
      duration: 140,
      easing: ease,
      useNativeDriver: true,
    }).start();
  const inactive = disabled || loading;
  const primary = variant === 'primary';

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => to(0.97)}
        onPressOut={() => to(1)}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!inactive, busy: !!loading }}
        style={({ pressed }) => [
          styles.base,
          primary ? styles.primary : styles.secondary,
          pressed && (primary ? styles.primaryPressed : styles.secondaryPressed),
          disabled && !loading && styles.disabled,
        ]}
      >
        <View style={styles.content}>
          {loading && (
            <ActivityIndicator size="small" color={primary ? colors.onNavy : colors.navy} />
          )}
          <Text style={[styles.label, { color: primary ? colors.onNavy : colors.navy }]}>
            {loading ? (loadingLabel ?? label) : label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.navy },
  primaryPressed: { backgroundColor: colors.navyPressed },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  secondaryPressed: { backgroundColor: colors.ground },
  disabled: { opacity: 0.5 },
  content: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontFamily: fonts.semibold, fontSize: 16, letterSpacing: -0.1 },
});
