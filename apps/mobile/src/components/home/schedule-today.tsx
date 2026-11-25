import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Card } from '../card';
import { Icon } from '../icon';
import type { ScheduleRow } from '@/lib/home-schedule';
import { colors, fonts, spacing } from '@/theme';

/** Today's tour-plan doctors. No clock is shown: the plan has no visit time. */
export function ScheduleToday({
  items,
  pending,
  error,
  onFullRoute,
}: {
  items: ScheduleRow[];
  pending: boolean;
  error: boolean;
  onFullRoute: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppText variant="chip" style={styles.section}>
          TODAY'S SCHEDULE
        </AppText>
        <Pressable
          onPress={onFullRoute}
          accessibilityRole="button"
          accessibilityLabel="Full route"
          hitSlop={8}
        >
          <AppText variant="action" style={styles.link}>
            Full Route
          </AppText>
        </Pressable>
      </View>
      <Card style={styles.card}>
        {pending ? (
          <AppText variant="small" style={styles.empty}>
            Loading today’s plan…
          </AppText>
        ) : error ? (
          <AppText variant="small" style={styles.empty}>
            Could not load today’s plan.
          </AppText>
        ) : items.length === 0 ? (
          <AppText variant="small" style={styles.empty}>
            No doctors on today’s tour plan.
          </AppText>
        ) : (
          items.map((d, i) => (
            <View key={d.id} style={[styles.row, i < items.length - 1 && styles.divider]}>
              <View style={styles.copy}>
                <AppText variant="rowTitle" numberOfLines={1}>
                  {d.name}
                </AppText>
                <AppText variant="small" numberOfLines={1}>
                  {d.detail}
                </AppText>
              </View>
              <View style={styles.status}>
                <Icon
                  name={d.visited ? 'check-circle-outline' : 'clock-outline'}
                  size={16}
                  color={d.visited ? colors.canopy : colors.subtle}
                />
                <AppText variant="small" style={d.visited ? styles.statusOn : styles.statusOff}>
                  {d.visited ? 'Visited' : 'Scheduled'}
                </AppText>
              </View>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  section: {
    color: colors.subtle,
    fontFamily: fonts.bold,
    letterSpacing: 0.6,
  },
  link: { color: colors.canopy, fontFamily: fonts.semibold },
  card: { paddingVertical: 0, overflow: 'hidden' },
  empty: { color: colors.muted, padding: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusOn: { color: colors.ink, fontFamily: fonts.semibold },
  statusOff: { color: colors.muted },
});
