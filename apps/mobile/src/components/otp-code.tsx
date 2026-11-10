import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { AppText } from './app-text';
import { colors, fonts, motion, radius, spacing } from '@/theme';

const LENGTH = 6;

type Props = {
  value: string;
  onChange: (next: string) => void;
  onComplete: (code: string) => void;
  error?: string;
  editable?: boolean;
};

/** Six cells over one hidden field so SMS autofill and paste still fill the code. */
export function OtpCode({ value, onChange, onComplete, error, editable = true }: Props) {
  const input = useRef<TextInputInstance>(null);
  const reduced = useReducedMotion();
  const shake = useSharedValue(0);
  const lastError = useRef<string | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 280);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!error || error === lastError.current) return;
    lastError.current = error;
    shake.value = reduced
      ? 0
      : withSequence(
          withTiming(-8, { duration: 50 }),
          withRepeat(withTiming(8, { duration: 70 }), 4, true),
          withTiming(0, { duration: 50 }),
        );
  }, [error, reduced, shake]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const active = Math.min(value.length, LENGTH - 1);

  function apply(raw: string) {
    const next = raw.replace(/\D/g, '').slice(0, LENGTH);
    onChange(next);
    if (next.length === LENGTH) onComplete(next);
  }

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => input.current?.focus()} accessibilityRole="none" style={styles.hit}>
        <Animated.View style={[styles.row, rowStyle]}>
          {Array.from({ length: LENGTH }, (_, i) => (
            <Cell
              key={i}
              char={value[i] ?? ''}
              focused={editable && i === active && value.length < LENGTH}
              filled={i < value.length}
              error={!!error}
            />
          ))}
        </Animated.View>
      </Pressable>
      <TextInput
        ref={input}
        value={value}
        onChangeText={apply}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        importantForAutofill="yes"
        maxLength={LENGTH}
        editable={editable}
        caretHidden
        accessibilityLabel="Sign-in code"
        accessibilityHint={error}
        style={styles.hidden}
      />
      {!!error && (
        <AppText variant="caption" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}
    </View>
  );
}

function Cell({
  char,
  focused,
  filled,
  error,
}: {
  char: string;
  focused: boolean;
  filled: boolean;
  error: boolean;
}) {
  const reduced = useReducedMotion();
  const pop = useSharedValue(filled ? 1 : 0.86);
  const caret = useSharedValue(1);

  useEffect(() => {
    if (!filled) {
      pop.value = 0.86;
      return;
    }
    pop.value = reduced ? 1 : withTiming(1, { duration: motion.fast, easing: motion.easeOut });
  }, [filled, char, pop, reduced]);

  useEffect(() => {
    caret.value =
      focused && !reduced
        ? withRepeat(
            withSequence(
              withTiming(0.15, { duration: 520, easing: Easing.linear }),
              withTiming(1, { duration: 520, easing: Easing.linear }),
            ),
            -1,
            false,
          )
        : 1;
  }, [focused, reduced, caret]);

  const digitStyle = useAnimatedStyle(() => ({
    opacity: filled ? 1 : 0,
    transform: [{ scale: pop.value }],
  }));
  const caretStyle = useAnimatedStyle(() => ({ opacity: focused ? caret.value : 0 }));

  return (
    <View
      style={[
        styles.cell,
        focused && styles.cellFocused,
        filled && styles.cellFilled,
        error && styles.cellError,
      ]}
    >
      <Animated.Text style={[styles.digit, digitStyle]}>{char}</Animated.Text>
      <Animated.View style={[styles.caret, caretStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, position: 'relative' },
  hit: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: spacing.sm },
  cell: {
    flex: 1,
    height: 56,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFocused: { borderColor: colors.tealDeep },
  cellFilled: { borderColor: colors.borderStrong },
  cellError: { borderColor: colors.danger, backgroundColor: colors.dangerWash },
  digit: {
    fontFamily: fonts.bold,
    fontSize: 24,
    lineHeight: 28,
    color: colors.ink,
  },
  caret: {
    position: 'absolute',
    width: 1.5,
    height: 22,
    borderRadius: 1,
    backgroundColor: colors.navy,
  },
  hidden: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 56,
    opacity: 0,
  },
  error: { color: colors.danger },
});
