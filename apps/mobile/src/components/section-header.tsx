import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { colors, spacing } from '@/theme';

export function SectionHeader({
  title,
  meta,
  action,
}: {
  title: string;
  /** Short muted note after the title, e.g. "1 of 4 met". */
  meta?: string;
  action?: { label: string; onPress: () => void; accessibilityLabel?: string };
}) {
  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <AppText variant="section" accessibilityRole="header">
          {title}
        </AppText>
        {meta ? <AppText variant="small">{meta}</AppText> : null}
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          hitSlop={spacing.md}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <AppText variant="label" style={styles.action}>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  titles: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexShrink: 1 },
  action: { color: colors.tealDeep },
  pressed: { opacity: 0.6 },
});
