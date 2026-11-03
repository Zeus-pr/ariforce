import type { KpiKey } from '@ariforce/contracts';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../app-text';
import { Card } from '../card';
import type { Kpi } from '@/mocks/home';
import { colors, fonts, layout, radius, spacing } from '@/theme';

function pairs<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 2) out.push(items.slice(i, i + 2));
  return out;
}

const SHORT: Partial<Record<KpiKey, string>> = {
  call_average: 'Call Avg',
  coverage_pct: 'Coverage',
  chemist_call_average: 'Chemist Calls',
  dcr_on_time_pct: 'DCR On-Time',
};

/** Stitch KPI Analytics 2×2 cards (MTD). */
export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppText variant="chip" style={styles.section}>
          KPI ANALYTICS
        </AppText>
        <AppText variant="small" style={styles.meta}>
          MTD Performance
        </AppText>
      </View>
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
    </View>
  );
}

function KpiCard({ kpi: k }: { kpi: Kpi }) {
  const pct = Math.round(Math.min(1, Math.max(0, k.progress)) * 100);
  const label = SHORT[k.key] ?? k.label;
  return (
    <Card
      style={[styles.cell, styles.card]}
      accessible
      accessibilityLabel={`${label}: ${k.value}. ${k.target}. ${pct}% of target.`}
    >
      <View style={styles.top}>
        <AppText variant="chip" style={styles.label} numberOfLines={1}>
          {label}
        </AppText>
        {k.delta ? (
          <AppText variant="chip" style={styles.delta}>
            {k.delta}
          </AppText>
        ) : (
          <AppText variant="chip" style={styles.pct}>
            {pct}%
          </AppText>
        )}
      </View>
      <AppText variant="kpi" style={styles.value} numberOfLines={1}>
        {k.value}
      </AppText>
      <AppText variant="small" numberOfLines={1}>
        {k.target}
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  section: {
    color: colors.subtle,
    fontFamily: fonts.bold,
    letterSpacing: 0.6,
  },
  meta: { color: colors.subtle },
  grid: { gap: layout.inner },
  row: { flexDirection: 'row', gap: layout.inner },
  cell: { flex: 1 },
  card: {
    height: 102,
    padding: spacing.md,
    borderRadius: radius.lg,
    justifyContent: 'space-between',
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    flex: 1,
    color: colors.subtle,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  delta: {
    color: colors.success,
    backgroundColor: 'rgba(21, 128, 61, 0.1)',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontFamily: fonts.semibold,
  },
  pct: { color: colors.canopy, fontFamily: fonts.semibold },
  value: { fontSize: 18, lineHeight: 22 },
});
