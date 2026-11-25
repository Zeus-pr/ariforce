import { StyleSheet, View } from 'react-native';
import { useState } from 'react';
import type { KpiKey, KpiReport } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { CallCapsule, DayStrip, GapRows, MonthColumns, RankRows, Ring } from '@/components/figures';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { MonthPager } from '@/components/month-pager';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useMyMonthDcrs } from '@/lib/dcr/api';
import { todayIST } from '@/lib/dcr/dates';
import {
  callMix,
  filedDates,
  gapBars,
  monthMarks,
  rankBars,
  ringModel,
  salesRings,
} from '@/lib/figures';
import {
  KPI_LABEL,
  formatKpi,
  monthKey,
  monthShort,
  useKpiBreakdown,
  useKpiHeadline,
  useKpiTrend,
  type KpiRow,
} from '@/lib/perf';
import { colors, layout, spacing } from '@/theme';

function metric(row: KpiRow | null | undefined, key: KpiKey) {
  return row?.metrics?.find((m) => m.kpi === key);
}

/** One month of real KPIs, drawn as a ring, ranked rows, and six columns. */
export function PerfView({
  title,
  kpis,
  rollup,
  breakdown,
  trendKey,
  field = false,
}: {
  title: string;
  kpis: readonly KpiKey[];
  rollup: KpiReport['rollup'];
  breakdown: 'byUser' | 'byTerritory' | null;
  /** The figure drawn across the six months and down the team. */
  trendKey: KpiKey;
  /** Your own calls and the month strip. Field activity only. */
  field?: boolean;
}) {
  const bottom = useBottomSpace();
  const [month, setMonth] = useState(() => monthKey());
  const scope =
    rollup === 'company' ? 'Whole company' : rollup === 'team' ? 'Your team' : 'Your numbers';

  const head = useKpiHeadline(month, kpis, rollup);
  const paired = kpis.includes('primary_sales_value') && kpis.includes('secondary_sales_value');
  const trendKpis: readonly KpiKey[] = paired
    ? ['primary_sales_value', 'secondary_sales_value']
    : [trendKey];
  const parts = useKpiBreakdown(month, kpis, breakdown, true);
  const trend = useKpiTrend(month, trendKpis, rollup, true);
  const mine = useMyMonthDcrs(month, field);
  const row = head.data;
  const metrics = row?.metrics ?? [];
  const rings = paired ? salesRings(metrics, formatKpi) : [];
  const ring = paired ? null : ringModel(kpis, metrics, formatKpi);
  const people = (parts.data ?? []).map((person) => ({
    id: person.userId ?? person.territoryId ?? person.label,
    label: person.label,
    metrics: person.metrics,
  }));
  const ranked = rankBars(people, trendKey, formatKpi, paired ? 'primary_sales_value' : undefined);
  const gaps = gapBars(people, kpis, formatKpi);
  const mix = callMix(mine.data ?? []);
  const marks = monthMarks(month, todayIST(), filedDates(mine.data ?? []));
  const trendUnit = (trend.data ?? []).map((t) => metric(t.row, trendKey)?.unit).find(Boolean);
  const seriesMax = (key: KpiKey) =>
    Math.max(0, ...(trend.data ?? []).map((t) => metric(t.row, key)?.value ?? 0));
  const trendMax = Math.max(1, seriesMax(trendKey), paired ? seriesMax('primary_sales_value') : 0);
  const columns = (trend.data ?? []).map((t) => {
    const m = metric(t.row, trendKey);
    const primary = metric(t.row, 'primary_sales_value');
    const value = m?.value ?? 0;
    const share =
      m?.value == null ? 0 : trendUnit === 'percent' ? Math.min(1, value / 100) : value / trendMax;
    const pairShare = primary?.value == null ? 0 : primary.value / trendMax;
    return {
      key: t.month,
      label: monthShort(t.month),
      text: m ? formatKpi(m.unit, m.value) : '—',
      share,
      pairShare,
      current: t.month === month,
    };
  });

  return (
    <View style={styles.flex}>
      <PullToRefresh
        onRefresh={() =>
          Promise.all([head.refetch(), parts.refetch(), trend.refetch(), mine.refetch()])
        }
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        >
          <MonthPager month={month} onChange={setMonth} caption={scope} />

          {head.isPending && !row ? (
            <SkeletonList count={4} />
          ) : head.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">
                Could not load {title.toLowerCase()}. Pull to try again.
              </AppText>
            </Card>
          ) : (
            <>
              {rings.length ? (
                <Card>
                  <View style={styles.ringRow}>
                    {rings.map((item) => (
                      <View key={item.title} style={styles.ringCell}>
                        <Ring
                          compact
                          percent={item.percent}
                          title={item.title}
                          caption={item.caption}
                        />
                      </View>
                    ))}
                  </View>
                </Card>
              ) : ring ? (
                <Card>
                  <Ring percent={ring.percent} title={ring.title} caption={ring.caption} />
                </Card>
              ) : null}
              <Card>
                {kpis.map((key, i) => {
                  const m = metric(row, key);
                  return (
                    <View key={key} style={[styles.line, i < kpis.length - 1 && styles.divider]}>
                      <AppText variant="label" style={styles.copy}>
                        {KPI_LABEL[key]}
                      </AppText>
                      <AppText variant="label">{m ? formatKpi(m.unit, m.value) : '—'}</AppText>
                    </View>
                  );
                })}
              </Card>
            </>
          )}

          {field ? (
            <Card style={styles.pad}>
              <AppText variant="label">Your calls</AppText>
              {mine.isPending ? (
                <AppText variant="small">Loading…</AppText>
              ) : mine.isError ? (
                <AppText variant="small">Could not load your calls.</AppText>
              ) : (
                <>
                  <CallCapsule {...mix} />
                  <DayStrip days={marks} />
                </>
              )}
            </Card>
          ) : null}

          {breakdown ? (
            <Card>
              <View style={styles.pad}>
                <AppText variant="label">
                  {breakdown === 'byUser' ? 'By person' : 'By zone'}
                </AppText>
              </View>
              {parts.isPending ? (
                <View style={styles.pad}>
                  <AppText variant="bodyMuted">Loading…</AppText>
                </View>
              ) : parts.isError ? (
                <View style={styles.pad}>
                  <AppText variant="bodyMuted">Could not load the breakdown.</AppText>
                </View>
              ) : !ranked.length ? (
                <View style={styles.pad}>
                  <AppText variant="bodyMuted">Nothing to break down this month.</AppText>
                </View>
              ) : (
                <>
                  {gaps.length ? (
                    <>
                      <View style={styles.pad}>
                        <AppText variant="label">Needs attention</AppText>
                      </View>
                      <GapRows rows={gaps} labelOf={(kpi) => KPI_LABEL[kpi as KpiKey] ?? kpi} />
                    </>
                  ) : null}
                  <RankRows rows={ranked} />
                </>
              )}
            </Card>
          ) : null}

          <Card>
            <View style={styles.pad}>
              <AppText variant="label">Last six months</AppText>
              {paired ? (
                <AppText variant="small">Navy is primary. Teal is secondary.</AppText>
              ) : (
                <AppText variant="small">{KPI_LABEL[trendKey]}</AppText>
              )}
            </View>
            {trend.isPending ? (
              <View style={styles.pad}>
                <AppText variant="bodyMuted">Loading…</AppText>
              </View>
            ) : trend.isError ? (
              <View style={styles.pad}>
                <AppText variant="bodyMuted">Could not load the earlier months.</AppText>
              </View>
            ) : (
              <MonthColumns columns={columns} paired={paired} />
            )}
          </Card>
        </ScrollView>
      </PullToRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.lg, gap: spacing.lg },
  pad: { padding: spacing.lg },
  fold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  copy: { flex: 1, gap: 2 },
  ringRow: { flexDirection: 'row' },
  ringCell: { flex: 1 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  trend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  trendMonth: { width: 36 },
  trendValue: { width: 88, textAlign: 'right' },
  track: {
    flex: 1,
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.separator,
    overflow: 'hidden',
  },
  fill: { backgroundColor: colors.tealDeep },
});
