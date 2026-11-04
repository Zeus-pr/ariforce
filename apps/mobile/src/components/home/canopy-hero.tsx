import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Icon } from '../icon';
import { PunchButton } from '../punch-button';
import { useAuth } from '@/lib/auth-context';
import {
  countTodayVisits,
  fieldErrorMessage,
  getDutyState,
  punch,
  readRememberedDuty,
  rememberDuty,
} from '@/lib/field';
import { formatDate, formatTime } from '@/lib/format';
import { dailyTargetFromMeToday, fetchMeToday } from '@/lib/me-today';
import { colors, fonts, layout, radius, spacing } from '@/theme';

type Target = {
  done: number;
  total: number;
  cluster: string;
  stp: string;
  hasPlanTarget: boolean;
};

/**
 * Stitch Field Command canopy: identity, date, Punch In / Punch Out, daily target.
 * Duty + target hydrate from GET /v1/me/today (caller-scoped — survives app reload).
 */
export function CanopyHero({
  name,
  role,
  now,
}: {
  name: string;
  role: string;
  now: Date;
}) {
  const { user } = useAuth();
  const [onDuty, setOnDuty] = useState(false);
  const [since, setSince] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);

  const refreshDuty = useCallback(async () => {
    try {
      // Instant paint from last successful punch (survives reload before API MeToday fix).
      const cached = await readRememberedDuty();
      if (cached?.onDuty) {
        setOnDuty(true);
        setSince(cached.punchedInAt);
      }
      const d = await getDutyState();
      // Prefer live open shift; if server still looks "out" but this device punched in today, keep it.
      if (d.onDuty) {
        setOnDuty(true);
        setSince(d.punchedInAt);
        void rememberDuty(true, d.punchedInAt);
      } else if (cached?.onDuty) {
        setOnDuty(true);
        setSince(cached.punchedInAt);
      } else {
        setOnDuty(false);
        setSince(null);
        void rememberDuty(false, null);
      }
      try {
        const today = await fetchMeToday();
        let visits = 0;
        if (user?.id) {
          try {
            visits = await countTodayVisits(user.id);
          } catch {
            visits = today.dcr?.calls ?? 0;
          }
        } else {
          visits = today.dcr?.calls ?? 0;
        }
        setTarget(dailyTargetFromMeToday(today, visits));
      } catch {
        // Target strip can wait; duty already applied.
      }
    } catch {
      // Keep last known local / cached state.
    } finally {
      setHydrated(true);
    }
  }, [user?.id]);

  useEffect(() => {
    void refreshDuty();
  }, [refreshDuty]);

  async function runPunch(kind: 'punch_in' | 'punch_out') {
    setBusy(true);
    try {
      const row = await punch(kind);
      const nextOn = kind === 'punch_in';
      const nextSince = nextOn ? new Date(row.capturedAt) : null;
      setOnDuty(nextOn);
      setSince(nextSince);
      await rememberDuty(nextOn, nextSince);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Reconcile with server (check-ins last-in wins — not stale MeToday "out").
      const d = await getDutyState();
      if (kind === 'punch_in') {
        if (d.onDuty) {
          setOnDuty(true);
          setSince(d.punchedInAt ?? nextSince);
          await rememberDuty(true, d.punchedInAt ?? nextSince);
        }
        // If server still lags, keep the successful local punch-in.
      } else {
        setOnDuty(false);
        setSince(null);
        await rememberDuty(false, null);
      }
      try {
        const today = await fetchMeToday();
        let visits = 0;
        if (user?.id) {
          try {
            visits = await countTodayVisits(user.id);
          } catch {
            visits = today.dcr?.calls ?? 0;
          }
        } else {
          visits = today.dcr?.calls ?? 0;
        }
        setTarget(dailyTargetFromMeToday(today, visits));
      } catch {
        // Local success state already applied.
      }
    } catch (e) {
      const msg = fieldErrorMessage(e);
      await refreshDuty();
      Alert.alert(kind === 'punch_in' ? 'Punch in' : 'Punch out', msg);
    } finally {
      setBusy(false);
    }
  }

  function onPress() {
    if (busy || !hydrated) return;
    if (!onDuty) {
      void runPunch('punch_in');
      return;
    }
    Alert.alert('Punch out?', 'This ends your shift. Today’s DCR must be submitted first.', [
      { text: 'Stay on duty', style: 'cancel' },
      { text: 'Punch Out', style: 'destructive', onPress: () => void runPunch('punch_out') },
    ]);
  }

  const done = target?.done ?? 0;
  const total = target?.total ?? 0;
  const hasPlan = target?.hasPlanTarget ?? false;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const segCount = hasPlan ? Math.max(total, 1) : Math.max(done, 1);
  const segments = Array.from({ length: segCount }, (_, i) => i < done);
  const statusLine = busy
    ? 'Getting location…'
    : onDuty && since
      ? `Since ${formatTime(since)}`
      : 'Checked out';

  return (
    <View style={styles.canopy}>
      <View style={styles.sky} pointerEvents="none" />
      <View style={styles.identity}>
        <View style={styles.identityLeft}>
          <AppText variant="small" style={styles.onCanopyMuted}>
            {statusLine}
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
        </View>
      </View>

      <PunchButton punchedIn={onDuty} onPress={onPress} loading={busy} disabled={!hydrated} />

      <View style={styles.target}>
        <View style={styles.targetRow}>
          <AppText variant="action" style={styles.onCanopySoft}>
            Daily Target
          </AppText>
          <AppText variant="action" style={styles.onCanopy}>
            {hasPlan ? (
              <>
                {done} of {total} Visits{' '}
                <AppText variant="small" style={styles.onCanopyMuted}>
                  ({pct}%)
                </AppText>
              </>
            ) : (
              <AppText variant="small" style={styles.onCanopyMuted}>
                {done > 0 ? `${done} visit${done === 1 ? '' : 's'} today · No plan target` : 'No plan target'}
              </AppText>
            )}
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
              {busy ? 'Capturing GPS…' : `GPS · ${target?.cluster ?? '—'}`}
            </AppText>
          </View>
          <AppText variant="small" style={styles.onCanopy} numberOfLines={1}>
            {target?.stp ?? '—'}
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
