import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Icon } from '@/components/icon';
import { colors, fonts, radius, spacing, touch, type } from '@/theme';

/** Rounded search field for list screens (clear button when it has text). */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.box}>
      <Icon name="magnify" color={colors.subtle} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        selectionColor={colors.tealDeep}
        cursorColor={colors.navy}
        accessibilityLabel={placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={styles.input}
      />
      {value ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={styles.clear}
        >
          <Icon name="close-circle" color={colors.subtle} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.min,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    paddingLeft: spacing.md,
  },
  input: {
    ...type.body,
    lineHeight: undefined,
    fontFamily: fonts.regular,
    flex: 1,
    minHeight: touch.min,
  },
  clear: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: spacing.md },
});
