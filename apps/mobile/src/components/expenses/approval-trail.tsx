import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { trailSteps, trailWhen, type TrailClaim, type TrailStatus } from '@/lib/expense-trail';
import { colors, fonts, radius, spacing } from '@/theme';

const DOT: Record<TrailStatus, { bg: string; border: string }> = {
  approved: { bg: colors.brandNavyCore, border: colors.brandNavyCore },
  pending: { bg: colors.brandTeal, border: colors.tealSoft },
  rejected: { bg: colors.danger, border: colors.danger },
  skipped: { bg: colors.ground, border: colors.separator },
  waiting: { bg: colors.surface, border: colors.borderStrong },
};
const ICON: Partial<Record<TrailStatus, 'check' | 'close' | 'clock-outline'>> = {
  approved: 'check',
  rejected: 'close',
  pending: 'clock-outline',
};

/** Vertical stepper: Submitted -> Level 1..N -> Paid; current level teal. */
export function ApprovalTrail({ claim }: { claim: TrailClaim }) {
  const steps = trailSteps(claim);
  return (
    <View accessibilityRole="list">
      {steps.map((s, i) => {
        const d = DOT[s.status];
        const icon = ICON[s.status];
        return (
          <View key={s.key} style={styles.row} accessibilityLabel={`${s.label}: ${s.status}`}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: d.bg, borderColor: d.border },
                  s.status === 'pending' && styles.dotCurrent,
                ]}
              >
                {icon ? <Icon name={icon} size={14} color={colors.onNavy} /> : null}
              </View>
              {i < steps.length - 1 ? (
                <View
                  style={[
                    styles.line,
                    {
                      backgroundColor:
                        s.status === 'approved' ? colors.brandNavyCore : colors.separator,
                    },
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.body}>
              <AppText
                variant="label"
                style={
                  s.status === 'pending'
                    ? styles.current
                    : s.status === 'rejected'
                      ? styles.rejected
                      : s.status === 'waiting' || s.status === 'skipped'
                        ? styles.muted
                        : undefined
                }
              >
                {s.label}
              </AppText>
              {s.who ? <AppText variant="small">{s.who}</AppText> : null}
              {s.at ? <AppText variant="small">{trailWhen(s.at)}</AppText> : null}
              {s.status === 'rejected' && s.note ? (
                <View style={styles.note}>
                  <AppText variant="caption" style={styles.rejected}>
                    “{s.note}”
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Compact dots for list rows. */
export function TrailDots({ claim }: { claim: TrailClaim }) {
  const steps = trailSteps(claim);
  return (
    <View style={styles.dots}>
      {steps.map((s) => (
        <View
          key={s.key}
          style={[
            styles.mini,
            {
              backgroundColor:
                s.status === 'approved'
                  ? colors.brandNavyCore
                  : s.status === 'pending'
                    ? colors.brandTeal
                    : s.status === 'rejected'
                      ? colors.danger
                      : colors.separator,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  rail: { alignItems: 'center', width: 28 },
  dot: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotCurrent: { borderWidth: 4 },
  line: { width: 2, flex: 1, minHeight: spacing.lg },
  body: { flex: 1, paddingBottom: spacing.lg, gap: 2 },
  current: { color: colors.tealDeep, fontFamily: fonts.semibold },
  rejected: { color: colors.danger },
  muted: { color: colors.subtle },
  note: {
    marginTop: spacing.xs,
    backgroundColor: colors.dangerWash,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  dots: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  mini: { width: 8, height: 8, borderRadius: radius.full },
});
