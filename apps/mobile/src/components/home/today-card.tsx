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
import { colors, motion, spacing } from '@/theme';

type Punch = { state: 'in' | 'out' | 'none'; at: Date | null };

/**
 * Today at a glance, in the order a rep works the day: punch in, the plan, the report.
 * Punch in/out is a local stub (no API, no GPS); the next step is expo-location + the attendance API.
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
  const when = punch.at ? formatTime(punch.at) : 'Punch in when you start work';

  return (
    <Card>
      <View style={styles.punchRow}>
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
          style={styles.punchText}
          accessible
          accessibilityLabel={`${status}${punch.at ? ` at ${when}` : ''}, ${data.attendance.place}`}
        >
          <AppText variant="headline" style={punchedIn && styles.success}>
            {status}
          </AppText>
          <AppText variant="caption">{when}</AppText>
          <AppText variant="small">{data.attendance.place} · GPS preview, not captured</AppText>
        </View>
        <Button
          label={punchedIn ? 'Punch out' : 'Punch in'}
          variant={punchedIn ? 'tint' : 'primary'}
          compact
          onPress={togglePunch}
        />
      </View>

      <View style={styles.rule} />

      <ListRow
        icon="calendar-month-outline"
        tone="blue"
        title={`Tour plan: ${plan.workType}`}
        subtitle={[`${plan.area} (${plan.band})`, plan.workWith && `with ${plan.workWith}`]
          .filter(Boolean)
          .join(' · ')}
        onPress={() => onOpen('tour-plan')}
        divider
      />
      <ListRow
        icon="clipboard-text-outline"
        tone={dcrToday.submitted ? 'green' : 'orange'}
        title={dcrToday.submitted ? 'DCR submitted' : 'DCR not submitted'}
        subtitle={`${dcrToday.submitted ? 'Done for today' : 'Due today'} · ${met} of ${doctorsToday.length} doctors met`}
        onPress={() => onOpen('dcr')}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  punchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  punchText: { flex: 1 },
  success: { color: colors.success },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
});
