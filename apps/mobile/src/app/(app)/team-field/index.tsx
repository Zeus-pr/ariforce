import { Redirect, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { PullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { useAuth } from '@/lib/auth-context';
import { dateLabel, todayIST } from '@/lib/dcr/dates';
import { googleMapsUrl } from '@/lib/field';
import { addDays } from '@/lib/leave';
import { canViewTeamField } from '@/lib/roles';
import {
  PUNCH_CHIP_LABEL,
  checkInTitle,
  checkInsForUser,
  punchChip,
  teamFieldMessage,
  timeIST,
  useTeamFieldDay,
} from '@/lib/team-field';
import type { AttendanceDay, CheckIn } from '@ariforce/contracts';
import { colors, layout, radius, spacing, touch } from '@/theme';

/** ABM+ / director / system admin: team punch and visit check-ins for one IST day. */
export default function TeamFieldScreen() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  if (!canViewTeamField(roles)) return <Redirect href="/" />;
  return <TeamField />;
}

function TeamField() {
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const today = todayIST();
  const [date, setDate] = useState(today);
  const [expanded, setExpanded] = useState<string | null>(null);
  // API includes the caller in teamUserIds; this screen is for reports only.
  const q = useTeamFieldDay(date, user?.id);

  const subtitle = useMemo(() => dateLabel(date), [date]);

  function shift(delta: number) {
    const next = addDays(date, delta);
    if (next > today) return;
    setDate(next);
    setExpanded(null);
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Team field' }} />
      <PullToRefresh onRefresh={() => q.refetch()}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        >
          <Card style={styles.dateCard}>
            <View style={styles.dateRow}>
              <PressableScale
                onPress={() => shift(-1)}
                hitSlop={8}
                accessibilityLabel="Previous day"
                scaleTo={0.92}
                style={styles.dateBtn}
                pressedStyle={styles.dateBtnPressed}
              >
                <Icon name="chevron-left" color={colors.ink} />
              </PressableScale>
              <View style={styles.dateCenter} accessible accessibilityRole="header">
                <AppText variant="label">{subtitle}</AppText>
                <AppText variant="small">{date === today ? 'Today · IST' : 'IST'}</AppText>
              </View>
              <PressableScale
                onPress={() => shift(1)}
                disabled={date >= today}
                hitSlop={8}
                accessibilityLabel="Next day"
                haptic={date < today}
                scaleTo={0.92}
                style={[styles.dateBtn, date >= today && styles.dateBtnDisabled]}
                pressedStyle={date < today ? styles.dateBtnPressed : undefined}
              >
                <Icon name="chevron-right" color={date >= today ? colors.subtle : colors.ink} />
              </PressableScale>
            </View>
            <AppText variant="small" style={styles.hint}>
              GPS is captured only at punch in, each visit and punch out.
            </AppText>
          </Card>

          {!q.isPending && !q.isError ? (
            <View style={styles.kpiRow}>
              <Kpi label="On field" value={q.summary.in} />
              <Kpi label="Day done" value={q.summary.out} />
              <Kpi label="Absent" value={q.summary.absent} />
              <Kpi label="Incomplete" value={q.summary.incomplete} />
            </View>
          ) : null}

          <AppText variant="small">Team ({q.isPending ? '…' : q.days.length})</AppText>

          {q.isPending ? (
            <SkeletonList count={4} />
          ) : q.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">{teamFieldMessage(q.error)}</AppText>
            </Card>
          ) : !q.days.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">Nobody on your team for this day.</AppText>
            </Card>
          ) : (
            <Card>
              {q.days.map((day, i) => (
                <PersonRow
                  key={day.userId}
                  day={day}
                  checkIns={checkInsForUser(q.checkIns, day.userId)}
                  outletNames={q.outletNames}
                  open={expanded === day.userId}
                  onToggle={() => setExpanded((id) => (id === day.userId ? null : day.userId))}
                  divider={i < q.days.length - 1}
                />
              ))}
            </Card>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.kpi}>
      <AppText variant="count">{value}</AppText>
      <AppText variant="small" style={styles.kpiLabel}>
        {label}
      </AppText>
    </View>
  );
}

function PersonRow({
  day,
  checkIns,
  outletNames,
  open,
  onToggle,
  divider,
}: {
  day: AttendanceDay;
  checkIns: CheckIn[];
  outletNames: ReadonlyMap<string, string>;
  open: boolean;
  onToggle: () => void;
  divider: boolean;
}) {
  const status = punchChip(day);
  const visits = day.visits;
  const inTime = day.punchIn ? timeIST(day.punchIn.capturedAt) : '—';
  const outTime = day.punchOut ? timeIST(day.punchOut.capturedAt) : '—';
  const detail =
    status === 'absent' && day.leave
      ? `Leave · ${day.leave.typeCode}${day.leave.half ? ` (${day.leave.half})` : ''}`
      : `${inTime} → ${outTime} · ${visits} visit${visits === 1 ? '' : 's'}`;
  const meta = `${PUNCH_CHIP_LABEL[status]} · ${detail}`;

  return (
    <View style={divider ? styles.personDivider : undefined}>
      <PressableScale
        onPress={onToggle}
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${day.userName}, ${meta}`}
        style={styles.personHead}
        pressedStyle={styles.personPressed}
      >
        <View style={styles.personText}>
          <AppText variant="rowTitle" numberOfLines={1}>
            {day.userName}
          </AppText>
          <AppText variant="small" numberOfLines={2}>
            {meta}
          </AppText>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} color={colors.subtle} />
      </PressableScale>
      {open ? (
        <View style={styles.timeline}>
          {!checkIns.length ? (
            <AppText variant="bodyMuted" style={styles.timelineEmpty}>
              No check-ins recorded.
            </AppText>
          ) : (
            checkIns.map((c, idx) => (
              <TimelineRow
                key={c.id}
                checkIn={c}
                title={checkInTitle(c, outletNames)}
                last={idx === checkIns.length - 1}
              />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function TimelineRow({ checkIn, title, last }: { checkIn: CheckIn; title: string; last: boolean }) {
  const { lat, lng } = checkIn.location;
  const hasGps = Number.isFinite(lat) && Number.isFinite(lng);

  return (
    <View style={[styles.timelineRow, !last && styles.timelineRowDivider]}>
      <View style={styles.timelineDotCol}>
        <View style={styles.timelineDot} />
        {!last ? <View style={styles.timelineLine} /> : null}
      </View>
      <View style={styles.timelineBody}>
        <View style={styles.timelineTop}>
          <AppText variant="label" style={styles.timelineTitle} numberOfLines={2}>
            {title}
          </AppText>
          {hasGps ? (
            <PressableScale
              onPress={() => Linking.openURL(googleMapsUrl(lat, lng)).catch(() => {})}
              hitSlop={8}
              accessibilityLabel={`Open ${title} in Google Maps`}
              scaleTo={0.92}
              style={styles.mapBtn}
              pressedStyle={styles.mapBtnPressed}
            >
              <Icon name="map-marker-radius-outline" size={20} color={colors.tealDeep} />
            </PressableScale>
          ) : null}
        </View>
        <AppText variant="small">{timeIST(checkIn.capturedAt)}</AppText>
        {checkIn.kind === 'visit' && checkIn.inFence === false ? (
          <AppText variant="small" style={styles.outside}>
            Outside fence
            {checkIn.distanceM != null ? ` · ${Math.round(checkIn.distanceM)} m` : ''}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  pad: { padding: spacing.lg },
  dateCard: { padding: spacing.lg, gap: spacing.sm },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateBtn: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
  },
  dateBtnPressed: { backgroundColor: colors.separator },
  dateBtnDisabled: { opacity: 0.45 },
  dateCenter: { flex: 1, alignItems: 'center' },
  hint: { textAlign: 'center', color: colors.muted },
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  kpi: {
    flex: 1,
    minWidth: '22%',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  kpiLabel: { textAlign: 'center', color: colors.muted },
  personDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  personHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  personPressed: { backgroundColor: colors.ground },
  personText: { flex: 1, gap: 2 },
  timeline: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.xs,
    backgroundColor: colors.ground,
  },
  timelineEmpty: { paddingVertical: spacing.sm },
  timelineRow: { flexDirection: 'row', gap: spacing.md, minHeight: 56 },
  timelineRowDivider: { paddingBottom: spacing.sm },
  timelineDotCol: { width: 12, alignItems: 'center' },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.teal,
    marginTop: 6,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.separator,
    marginTop: 4,
  },
  timelineBody: { flex: 1, gap: 2, paddingBottom: spacing.sm },
  timelineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  timelineTitle: { flex: 1 },
  mapBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tealWash,
  },
  mapBtnPressed: { backgroundColor: colors.tealSoft },
  outside: { color: colors.muted },
});
