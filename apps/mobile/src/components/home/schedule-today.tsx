import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Card } from '../card';
import { Icon } from '../icon';
import { formatTime } from '@/lib/format';
import type { PlannedDoctor } from '@/mocks/home';
import { colors, fonts, spacing } from '@/theme';

function slotParts(d: Date) {
  const label = formatTime(d);
  const [clock, period] = label.split(' ');
  return { clock, period: period ?? '' };
}

/** Stitch Today's Schedule: timed rows with Visited / Scheduled status. */
export function ScheduleToday({
  items,
  onFullRoute,
}: {
  items: PlannedDoctor[];
  onFullRoute: () => void;
}) {
  if (!items.length) return null;
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
        {items.map((d, i) => {
          const { clock, period } = slotParts(d.plannedAt);
          const visited = !!d.metAt;
          return (
            <View key={d.id} style={[styles.row, i < items.length - 1 && styles.divider]}>
              <View style={styles.time}>
                <AppText variant="action" style={styles.clock}>
                  {clock}
                </AppText>
                <AppText variant="chip" style={styles.period}>
                  {period}
                </AppText>
              </View>
              <View style={styles.copy}>
                <AppText variant="rowTitle" numberOfLines={1}>
                  {d.name}
                </AppText>
                <AppText variant="small" numberOfLines={1}>
                  {d.speciality} • {d.area}
                </AppText>
              </View>
              <View style={styles.status}>
                <Icon
                  name={visited ? 'check-circle-outline' : 'clock-outline'}
                  size={16}
                  color={visited ? colors.canopy : colors.subtle}
                />
                <AppText
                  variant="small"
                  style={visited ? styles.statusOn : styles.statusOff}
                >
                  {visited ? 'Visited' : 'Scheduled'}
                </AppText>
              </View>
            </View>
          );
        })}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  time: { width: 48 },
  clock: { color: colors.ink, fontFamily: fonts.bold, fontSize: 13 },
  period: {
    color: colors.subtle,
    fontFamily: fonts.semibold,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusOn: { color: colors.ink, fontFamily: fonts.semibold },
  statusOff: { color: colors.muted },
});
