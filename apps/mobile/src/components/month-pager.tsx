import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { Icon } from './icon';
import { todayIST } from '@/lib/dcr/dates';
import { monthKey, monthTitle } from '@/lib/perf';
import { colors, radius, spacing } from '@/theme';

/** One month control: the title sits between its two arrows, not stretched across the screen. */
export function MonthPager({
  month,
  onChange,
  caption,
}: {
  month: string;
  onChange: (month: string) => void;
  caption?: string;
}) {
  const atCurrent = month >= todayIST().slice(0, 7);
  return (
    <View style={styles.wrap}>
      <View style={styles.cluster}>
        <Pressable
          onPress={() => onChange(monthKey(-1, month))}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={8}
          style={styles.btn}
        >
          <Icon name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
        <AppText variant="section" style={styles.title} accessibilityRole="header">
          {monthTitle(month)}
        </AppText>
        <Pressable
          onPress={() => onChange(monthKey(1, month))}
          disabled={atCurrent}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={8}
          style={styles.btn}
        >
          <Icon
            name="chevron-right"
            size={22}
            color={atCurrent ? colors.borderStrong : colors.ink}
          />
        </Pressable>
      </View>
      {caption ? <AppText variant="small">{caption}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs },
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.xs,
  },
  btn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { minWidth: 168, textAlign: 'center' },
});
