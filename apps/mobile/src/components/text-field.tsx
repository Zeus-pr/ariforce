import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import { AppText } from './app-text';
import { colors, fonts, radius, spacing, touch, type } from '@/theme';

type Props = TextInputProps & {
  label: string;
  error?: string | null;
  /** Adds a Show/Hide toggle and starts hidden. */
  secret?: boolean;
};

/** Labelled input with inline error (field errors never go to a dialog). */
export const TextField = forwardRef<TextInputInstance, Props>(function TextField(
  { label, error, secret, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  return (
    <View style={styles.wrap}>
      <AppText variant="label">{label}</AppText>
      <View style={[styles.box, focused && styles.boxFocused, !!error && styles.boxError]}>
        <TextInput
          ref={ref}
          {...rest}
          secureTextEntry={secret ? hidden : rest.secureTextEntry}
          placeholderTextColor={colors.subtle}
          selectionColor={colors.tealDeep}
          cursorColor={colors.navy}
          accessibilityLabel={label}
          accessibilityHint={error ?? undefined}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, style]}
        />
        {secret && (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
          >
            <AppText variant="label" style={styles.toggleText}>
              {hidden ? 'Show' : 'Hide'}
            </AppText>
          </Pressable>
        )}
      </View>
      {!!error && (
        <AppText variant="caption" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touch.control,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    paddingLeft: spacing.lg,
  },
  boxFocused: { borderColor: colors.tealDeep },
  boxError: { borderColor: colors.danger },
  // 16px minimum input text (mobile-native): readable, and iOS never zooms.
  input: {
    ...type.body,
    lineHeight: undefined,
    fontFamily: fonts.regular,
    flex: 1,
    minHeight: touch.control,
    paddingVertical: spacing.md,
  },
  toggle: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: spacing.lg },
  togglePressed: { opacity: 0.6 },
  toggleText: { color: colors.tealDeep },
  error: { color: colors.danger },
});
