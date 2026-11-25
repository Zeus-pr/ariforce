import { StyleSheet, View } from 'react-native';
import { AppText } from './app-text';
import { Card } from './card';
import { dateLabel, todayIST } from '@/lib/dcr/dates';
import { formatINR } from '@/lib/money';
import { useOutletActivity, type OutletVisit } from '@/lib/outlet-activity';
import type { OutletKind } from '@/lib/field';
import { colors, spacing } from '@/theme';

function facts(v: OutletVisit) {
  const parts: string[] = [];
  if (v.samples > 0) parts.push(`${v.samples} ${v.samples === 1 ? 'sample' : 'samples'}`);
  if (v.pob != null) parts.push(`Order ${formatINR(v.pob)}`);
  if (v.rcpa > 0) parts.push(`${v.rcpa} RCPA`);
  return parts.join('  ·  ');
}

/** Real visit, sample, and order history for a doctor, chemist, or stockist. */
export function OutletActivity({ kind, outletId }: { kind: OutletKind; outletId: string }) {
  const q = useOutletActivity(kind, outletId);
  const month = todayIST().slice(0, 7);
  const visits = q.data ?? [];
  const monthVisits = visits.filter((v) => v.date.startsWith(month));
  const monthSamples = monthVisits.reduce((s, v) => s + v.samples, 0);
  const monthPob = monthVisits.reduce((s, v) => s + (v.pob ?? 0), 0);
  const summary = [
    `${monthVisits.length} ${monthVisits.length === 1 ? 'visit' : 'visits'} this month`,
    monthSamples ? `${monthSamples} samples` : null,
    monthPob ? formatINR(monthPob) : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppText variant="section">Visits</AppText>
        <AppText variant="small">Last 90 days</AppText>
      </View>
      {q.isPending ? (
        <Card style={styles.pad}>
          <AppText variant="bodyMuted">Loading visits…</AppText>
        </Card>
      ) : q.isError ? (
        <Card style={styles.pad}>
          <AppText variant="bodyMuted">Could not load visits. Pull to try again.</AppText>
        </Card>
      ) : !visits.length ? (
        <Card style={styles.pad}>
          <AppText variant="bodyMuted">No visits recorded.</AppText>
        </Card>
      ) : (
        <Card>
          <View style={styles.summary}>
            <AppText variant="small">{summary}</AppText>
          </View>
          {visits.map((v, i) => {
            const line = facts(v);
            return (
              <View key={v.id} style={[styles.row, i < visits.length - 1 && styles.divider]}>
                <AppText variant="label">{dateLabel(v.date)}</AppText>
                {line ? <AppText variant="small">{line}</AppText> : null}
                {v.remarks ? (
                  <AppText variant="small" numberOfLines={2}>
                    {v.remarks}
                  </AppText>
                ) : null}
                {v.inFence === false ? (
                  <AppText variant="small" style={styles.out}>
                    Outside the saved location
                  </AppText>
                ) : null}
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  head: { gap: 2 },
  pad: { padding: spacing.lg },
  summary: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 2 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  out: { color: colors.warn },
});
