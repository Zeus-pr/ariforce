import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Chip } from '../chip';
import { Icon } from '../icon';
import { PunchButton } from '../punch-button';
import { formatDate, formatTime } from '@/lib/format';
import type { HomeData } from '@/mocks/home';
import { colors, fonts, layout, radius, spacing } from '@/theme';

/**
 * Stitch Field Command canopy: identity, date, 3D Punch In / Punch Out button, daily target.
 * Punch state is local-only (same stub as the old TodayCard).
 */
export function CanopyHero({
  name,
  role,
  now,
  data,
  sample,
}: {
  name: string;
  role: string;
  now: Date;
  data: Pick<HomeData, 'attendance' | 'dailyTarget'>;
  sample?: boolean;
}) {
  const [onDuty, setOnDuty] = useState(() => !!data.attendance.punchedInAt);
  const [since, setSince] = useState<Date | null>(() => data.attendance.punchedInAt);

  const { done, total, cluster, stp } = data.dailyTarget;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const segments = Array.from({ length: Math.max(total, 1) }, (_, i) => i < done);

  function onConfirm() {
    setOnDuty((was) => {
      const next = !was;
      setSince(next ? new Date() : null);
      return next;
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }

  // Punching out ends the shift, so ask first to avoid an accidental tap.
  function onPress() {
    if (!onDuty) return onConfirm();
    Alert.alert('Punch out?', 'This ends your shift.', [
      { text: 'Stay on duty', style: 'cancel' },
      { text: 'Punch Out', style: 'destructive', onPress: onConfirm },
    ]);
  }

  return (
    <View style={styles.canopy}>
      <View style={styles.sky} pointerEvents="none" />
      <View style={styles.identity}>
        <View style={styles.identityLeft}>
          <AppText variant="small" style={styles.onCanopyMuted}>
            {onDuty && since ? `Since ${formatTime(since)}` : 'Checked out'}
          </AppText>
          <AppText
            variant="name"
            style={styles.onCanopy}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {name}
          </AppText>
          <AppText variant="small" style={styles.onCanopyMuted} numberOfLines={1}>
            {role}
          </AppText>
        </View>
        <View style={styles.identityRight}>
          <AppText variant="action" style={styles.onCanopy}>
            {formatDate(now).replace(/ \d{4}$/, '')}
          </AppText>
          <AppText variant="small" style={styles.onCanopyMuted}>
            Today
          </AppText>
          {sample ? <Chip label="Sample" tone="orange" /> : null}
        </View>
      </View>

      <PunchButton punchedIn={onDuty} onPress={onPress} />

      <View style={styles.target}>
        <View style={styles.targetRow}>
          <AppText variant="action" style={styles.onCanopySoft}>
            Daily Target
          </AppText>
          <AppText variant="action" style={styles.onCanopy}>
            {done} of {total} Visits{' '}
            <AppText variant="small" style={styles.onCanopyMuted}>
              ({pct}%)
            </AppText>
          </AppText>
        </View>
        <View style={styles.segments}>
          {segments.map((on, i) => (
            <View key={i} style={[styles.segment, on ? styles.segmentOn : styles.segmentOff]} />
          ))}
        </View>
        <View style={styles.targetRow}>
          <View style={styles.gps}>
            <Icon name="crosshairs-gps" size={14} color="#6EE7B7" />
            <AppText variant="small" style={styles.onCanopySoft} numberOfLines={1}>
              GPS Verified • {cluster}
            </AppText>
          </View>
          <AppText variant="small" style={styles.onCanopy}>
            STP: {stp}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canopy: {
    backgroundColor: colors.canopy,
    marginHorizontal: -layout.gutter,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.sm,
    // Extra bottom so the overlapping sheet radius sits fully on teal (no white peek).
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  sky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    height: 1000,
    backgroundColor: colors.canopy,
  },
  identity: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  identityLeft: { flex: 1, minWidth: 0 },
  identityRight: { alignItems: 'flex-end', gap: 2 },
  onCanopy: { color: colors.onNavy, fontFamily: fonts.bold },
  onCanopySoft: { color: 'rgba(255,255,255,0.95)' },
  onCanopyMuted: { color: colors.onSkyMuted },
  target: {
    backgroundColor: colors.canopyDeep,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    padding: spacing.md,
    gap: spacing.sm,
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  segments: { flexDirection: 'row', gap: 6, height: 8 },
  segment: { flex: 1, borderRadius: radius.full },
  segmentOn: { backgroundColor: colors.onNavy },
  segmentOff: { backgroundColor: 'rgba(255,255,255,0.25)' },
  gps: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
});
