import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { AppText } from '../app-text';
import { Button } from '../button';
import { Card } from '../card';
import { ListRow } from '../list-row';
import { TintedIcon } from '../tinted-icon';
import type { FeatureKey } from '@/lib/features';
import { formatTime } from '@/lib/format';
import type { HomeData } from '@/mocks/home';
import { colors, motion, sizes, spacing } from '@/theme';

type Punch = { state: 'in' | 'out' | 'none'; at: Date | null };

/**
 * Today at a glance, in the order a rep works the day: punch in, the plan, the report.
 * Three rows of identical height (sizes.row): icon tile, one-line title, one-line subtitle.
 * Punch in/out is a local stub (no API, no GPS); real punch-in needs expo-location + the API.
 */
export function TodayCard({
  data,
  onOpen,
}: {
  data: Pick<HomeData, 'attendance' | 'todayPlan' | 'dcrToday' | 'doctorsToday'>;
  onOpen: (feature: FeatureKey) => void;
}) {
  const reduced = useReducedMotion();
  const [punch, setPunch] = useState<Punch>(() =>
    data.attendance.punchedInAt
      ? { state: 'in', at: data.attendance.punchedInAt }
      : { state: 'none', at: null },
  );

  function togglePunch() {
    setPunch((p) => ({ state: p.state === 'in' ? 'out' : 'in', at: new Date() }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  const { todayPlan: plan, dcrToday, doctorsToday } = data;
  const met = doctorsToday.filter((d) => d.metAt).length;
  const punchedIn = punch.state === 'in';
  const status =
    punch.state === 'in' ? 'Punched in' : punch.state === 'out' ? 'Punched out' : 'Not punched in';
  const title = punch.at ? `${status} · ${formatTime(punch.at)}` : status;

  return (
    <Card>
      <View style={[styles.punchRow, styles.divider]}>
        <Animated.View
          key={punch.state}
          entering={reduced ? undefined : FadeIn.duration(motion.fast)}
        >
          <TintedIcon
            name={punchedIn ? 'check-circle' : 'map-marker-outline'}
            tone={punchedIn ? 'green' : 'neutral'}
          />
        </Animated.View>
        <View
          style={styles.text}
          accessible
          accessibilityLabel={`${title}, ${data.attendance.place}, location not captured`}
        >
          <AppText variant="rowTitle" style={punchedIn && styles.success} numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="small" numberOfLines={1}>
            {data.attendance.place} · GPS stub
          </AppText>
        </View>
        <Button
          label={punchedIn ? 'Punch out' : 'Punch in'}
          variant={punchedIn ? 'tint' : 'primary'}
          compact
          onPress={togglePunch}
        />
      </View>

      <ListRow
        icon="calendar-month-outline"
        tone="blue"
        title={`${plan.workType} · ${plan.area} (${plan.band})`}
        subtitle={plan.workWith ? `Tour plan · with ${plan.workWith}` : 'Tour plan · working alone'}
        onPress={() => onOpen('tour-plan')}
        divider
      />
      <ListRow
        icon="clipboard-text-outline"
        tone={dcrToday.submitted ? 'green' : 'orange'}
        title={dcrToday.submitted ? 'DCR submitted' : 'DCR due today'}
        subtitle={`${met} of ${doctorsToday.length} doctors met`}
        onPress={() => onOpen('dcr')}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  // Same box as ListRow: height sizes.row, gutter padding, icon tile + text.
  punchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  text: { flex: 1 },
  success: { color: colors.success },
});
