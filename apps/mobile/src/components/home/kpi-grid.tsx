import type { KpiKey } from '@ariforce/contracts';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Card } from '../card';
import type { IconName } from '../icon';
import { SectionHeader } from '../section-header';
import { TintedIcon } from '../tinted-icon';
import type { Kpi } from '@/mocks/home';
import { colors, layout, radius, sizes, spacing, tones, type Tone } from '@/theme';

const LOOK: Partial<Record<KpiKey, { icon: IconName; tone: Tone }>> = {
  call_average: { icon: 'account-group-outline', tone: 'teal' },
  coverage_pct: { icon: 'target', tone: 'blue' },
  chemist_call_average: { icon: 'pill', tone: 'green' },
  dcr_on_time_pct: { icon: 'clock-check-outline', tone: 'orange' },
};
const FALLBACK = { icon: 'chart-line', tone: 'neutral' } as const;

function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}

/**
 * This month's KPIs in explicit rows of two: equal widths (flex 1) and equal heights (row
 * stretch, one line per text), so every card is the same box. An odd last card keeps its half.
 */
export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <>
      <SectionHeader title="This month" />
      <View style={styles.grid}>
        {pairs(kpis).map((row) => (
          <View key={row.map((k) => k.key).join('-')} style={styles.row}>
            {row.map((k) => (
              <KpiCard key={k.key} kpi={k} />
            ))}
            {row.length === 1 ? <View style={styles.cell} /> : null}
          </View>
        ))}
      </View>
    </>
  );
}

function KpiCard({ kpi: k }: { kpi: Kpi }) {
  const look = LOOK[k.key] ?? FALLBACK;
  const pct = Math.round(Math.min(1, Math.max(0, k.progress)) * 100);
  return (
    <Card
      style={[styles.cell, styles.card]}
      accessible
      accessibilityLabel={`${k.label}: ${k.value}. ${k.target}. ${pct}% of target.`}
    >
      <View style={styles.top}>
        <AppText variant="caption" style={styles.label} numberOfLines={1}>
          {k.label}
        </AppText>
        <TintedIcon name={look.icon} tone={look.tone} />
      </View>
      <AppText variant="kpi" numberOfLines={1}>
        {k.value}
      </AppText>
      <AppText variant="small" numberOfLines={1}>
        {k.target}
      </AppText>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: tones[look.tone].fg }]} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { gap: layout.inner },
  row: { flexDirection: 'row', gap: layout.inner },
  cell: { flex: 1 },
  card: { padding: spacing.lg },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  label: { flex: 1 },
  track: {
    height: sizes.progress,
    borderRadius: radius.full,
    backgroundColor: colors.separator,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.full },
});
