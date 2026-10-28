import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import { colors, fonts, radius } from '@/theme';

type Props = TextInputProps & {
  label: string;
  error?: string | null;
  /** Adds a Show/Hide toggle and starts hidden. */
  secret?: boolean;
};

export const TextField = forwardRef<TextInputInstance, Props>(function TextField(
  { label, error, secret, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, focused && styles.boxFocused, !!error && styles.boxError]}>
        <TextInput
          ref={ref}
          {...rest}
          secureTextEntry={secret ? hidden : rest.secureTextEntry}
          placeholderTextColor={colors.subtle}
          selectionColor={colors.tealDeep}
          cursorColor={colors.navy}
          accessibilityLabel={label}
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
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            style={styles.toggle}
          >
            <Text style={styles.toggleText}>{hidden ? 'Show' : 'Hide'}</Text>
          </Pressable>
        )}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  boxFocused: { borderColor: colors.tealDeep, borderWidth: 1.5, paddingHorizontal: 13.5 },
  boxError: { borderColor: colors.danger },
  input: { flex: 1, height: '100%', fontFamily: fonts.regular, fontSize: 16, color: colors.ink },
  toggle: { paddingLeft: 12, paddingVertical: 6 },
  toggleText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.tealDeep },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
});
