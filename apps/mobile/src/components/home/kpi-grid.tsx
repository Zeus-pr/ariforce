import type { KpiKey } from '@ariforce/contracts';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Card } from '../card';
import type { IconName } from '../icon';
import { SectionHeader } from '../section-header';
import { TintedIcon } from '../tinted-icon';
import type { Kpi } from '@/mocks/home';
import { colors, radius, sizes, spacing, tones, type Tone } from '@/theme';

const LOOK: Partial<Record<KpiKey, { icon: IconName; tone: Tone }>> = {
  call_average: { icon: 'account-group-outline', tone: 'teal' },
  coverage_pct: { icon: 'target', tone: 'blue' },
  chemist_call_average: { icon: 'pill', tone: 'green' },
  dcr_on_time_pct: { icon: 'clock-check-outline', tone: 'orange' },
};
const FALLBACK = { icon: 'chart-line', tone: 'neutral' } as const;

/** This month's KPIs, 2×2, each against its target with a thin progress bar. */
export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <>
      <SectionHeader title="This month" />
      <View style={styles.grid}>
        {kpis.map((k) => {
          const look = LOOK[k.key] ?? FALLBACK;
          const pct = Math.round(Math.min(1, Math.max(0, k.progress)) * 100);
          return (
            <Card
              key={k.key}
              style={styles.card}
              accessible
              accessibilityLabel={`${k.label}: ${k.value}. ${k.target}. ${pct}% of target.`}
            >
              <View style={styles.top}>
                <AppText variant="caption" style={styles.label} numberOfLines={2}>
                  {k.label}
                </AppText>
                <TintedIcon name={look.icon} tone={look.tone} />
              </View>
              <AppText variant="kpi">{k.value}</AppText>
              <AppText variant="small">{k.target}</AppText>
              <View style={styles.track}>
                <View
                  style={[styles.fill, { width: `${pct}%`, backgroundColor: tones[look.tone].fg }]}
                />
              </View>
            </Card>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: { flexBasis: '47%', flexGrow: 1, padding: spacing.lg, gap: spacing.xs },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  label: { flex: 1 },
  track: {
    height: sizes.progress,
    borderRadius: radius.full,
    backgroundColor: colors.separator,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.full },
});
