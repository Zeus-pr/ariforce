import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { trailSteps, type TrailClaim, type TrailStatus } from '@/lib/expense-trail';
import { colors, radius, spacing } from '@/theme';

const DOT: Record<TrailStatus, { bg: string; border: string }> = {
  approved: { bg: colors.brandNavyCore, border: colors.brandNavyCore },
  pending: { bg: colors.brandTeal, border: colors.tealSoft },
  rejected: { bg: colors.danger, border: colors.danger },
  skipped: { bg: colors.ground, border: colors.separator },
  waiting: { bg: colors.surface, border: colors.borderStrong },
};

const HEADLINE: Record<TrailClaim['status'], string> = {
  draft: 'Not submitted',
  submitted: 'In approval',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
};

/** Horizontal level dots. The count is the server's totalLevels, not a fixed three. */
export function ApprovalTrail({ claim }: { claim: TrailClaim }) {
  const steps = trailSteps(claim);
  const levels = steps.filter((s) => s.key.startsWith('l'));
  const paid = steps.find((s) => s.key === 'paid');
  const rejected = levels.find((s) => s.status === 'rejected' && s.note);
  const inset = levels.length > 1 ? `${100 / (levels.length * 2)}%` : '50%';

  return (
    <View style={styles.wrap} accessibilityRole="list">
      <View style={styles.headline}>
        <AppText variant="label">{HEADLINE[claim.status]}</AppText>
        <AppText variant="small">
          {levels.length} {levels.length === 1 ? 'level' : 'levels'}
        </AppText>
      </View>
      <View style={styles.track}>
        {levels.length > 1 ? (
          <View style={[styles.trackLine, { left: inset, right: inset }]} />
        ) : null}
        {levels.map((s) => {
          const d = DOT[s.status];
          return (
            <View key={s.key} style={styles.level} accessibilityLabel={`${s.label}: ${s.status}`}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: d.bg, borderColor: d.border },
                  s.status === 'pending' && styles.dotCurrent,
                ]}
              />
              <AppText variant="small">{s.label}</AppText>
              {s.who ? (
                <AppText variant="small" numberOfLines={2} style={styles.who}>
                  {s.who}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>
      {paid?.status === 'approved' && paid.who ? (
        <AppText variant="small">{paid.who}</AppText>
      ) : null}
      {rejected?.note ? (
        <View style={styles.note}>
          <AppText variant="caption" style={styles.rejected}>
            “{rejected.note}”
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** One dot per approval level, for a claim row. */
export function TrailDots({ claim }: { claim: TrailClaim }) {
  const steps = trailSteps(claim).filter((s) => s.key.startsWith('l'));
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
  wrap: { gap: spacing.md },
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  track: { flexDirection: 'row', alignItems: 'flex-start' },
  trackLine: {
    position: 'absolute',
    top: 6,
    height: 2,
    backgroundColor: colors.separator,
  },
  level: { flex: 1, alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  dot: {
    width: 14,
    height: 14,
    borderRadius: radius.full,
    borderWidth: 2,
  },
  dotCurrent: { width: 16, height: 16, borderWidth: 3 },
  who: { textAlign: 'center' },
  rejected: { color: colors.danger },
  note: {
    backgroundColor: colors.dangerWash,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  dots: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  mini: { width: 8, height: 8, borderRadius: radius.full },
});
