import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { AppText } from './app-text';
import { colors, fonts, radius, spacing } from '@/theme';

export type StatusOption = { key: string; label: string; count: number };

/**
 * One open list. The first option that has items is the default, so a daily visit
 * lands on work (rejected, drafts) instead of the long approved history.
 * A choice sticks until that bucket is empty.
 */
export function useStatusKey(options: StatusOption[], keepEmpty = false) {
  const [chosen, setChosen] = useState<string | null>(null);
  const live = keepEmpty ? options : options.filter((option) => option.count > 0);
  const value =
    chosen && live.some((option) => option.key === chosen)
      ? chosen
      : (live.find((option) => option.count > 0)?.key ?? live[0]?.key ?? null);
  return { live, value, setChosen };
}

/** Horizontal status switch. Hidden when there is only one list to show. */
export function StatusPicker({
  options,
  value,
  onChange,
}: {
  options: StatusOption[];
  value: string | null;
  onChange: (key: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {options.map((option) => {
        const on = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${option.label}, ${option.count}`}
            style={[styles.pill, on && styles.pillOn]}
          >
            <AppText variant="chip" style={[styles.label, on && styles.labelOn]}>
              {option.label}
            </AppText>
            <AppText variant="chip" style={[styles.count, on && styles.labelOn]}>
              {option.count}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  pill: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pillOn: { backgroundColor: colors.canopy, borderColor: colors.canopy },
  label: { color: colors.ink, fontFamily: fonts.semibold },
  count: { color: colors.muted, fontFamily: fonts.semibold },
  labelOn: { color: colors.surface },
});
