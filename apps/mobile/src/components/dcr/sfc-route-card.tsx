import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { bandOf, sfcCategoryOf } from '@/lib/dcr/bands';
import { BAND_LABEL, MODE_LABEL, type Candidate } from '@/lib/dcr/model';
import { colors, radius, spacing } from '@/theme';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
const km = (n: number) =>
  `${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n)} km`;
const money = (n: number | null, actualFare = false) =>
  actualFare ? 'Actual fare' : n == null ? 'Not set in SFC' : inr.format(n);

function bandText(c: { band: unknown; category: unknown }) {
  const band = bandOf(c.band);
  const cat = sfcCategoryOf(c.category);
  if (!band) return 'Not set';
  return cat ? `${BAND_LABEL[band]} (${cat.toUpperCase()})` : BAND_LABEL[band];
}

/** Fields shared by a live SFC candidate and a frozen submit snapshot. */
export type SfcFacts = {
  fromPlace: string;
  toPlace: string;
  oneWayKm: number;
  bothWayKm: number;
  oneWayAmount: number | null;
  bothWayAmount: number | null;
  actualFare: boolean;
  travelMode: string | null;
  category: unknown;
  band: unknown;
  da: number | null;
  source?: 'own' | 'hq';
  /** Present on frozen snapshots only. */
  ratePerKm?: number;
};

export function candidateFacts(c: Candidate): SfcFacts {
  return {
    fromPlace: c.fromPlace,
    toPlace: c.toPlace,
    oneWayKm: c.oneWayKm,
    bothWayKm: c.bothWayKm,
    oneWayAmount: c.oneWayAmount,
    bothWayAmount: c.bothWayAmount,
    actualFare: c.actualFare,
    travelMode: c.travelMode,
    category: c.category,
    band: c.band,
    da: c.da,
    source: c.source,
  };
}

/**
 * Read-only SFC route + TA/DA (web RouteFacts): band, travel, distance, TA both ways, DA,
 * and rate/km when the snapshot has it.
 */
export function SfcRouteCard({
  title,
  facts,
  note,
}: {
  title: string;
  facts: SfcFacts;
  note: string;
}) {
  const rows: [string, string][] = [
    ['Band', bandText(facts)],
    ['Travel', facts.travelMode ? (MODE_LABEL[facts.travelMode] ?? facts.travelMode) : 'Not set'],
    ['Distance', `${km(facts.oneWayKm)} one way · ${km(facts.bothWayKm)} both`],
    ['TA (one way)', money(facts.oneWayAmount, facts.actualFare)],
    ['TA (both ways)', money(facts.bothWayAmount, facts.actualFare)],
    ['DA', money(facts.da)],
  ];
  if (facts.ratePerKm != null) rows.push(['TA rate', `${inr.format(facts.ratePerKm)}/km`]);

  return (
    <View style={styles.card} accessibilityLabel="SFC details and TA/DA">
      <View style={styles.head}>
        <View style={styles.flex}>
          <AppText variant="body">{title}</AppText>
          {facts.source === 'hq' ? (
            <AppText variant="small">
              From HQ: this is your headquarter’s shared route, not one set up for you.
            </AppText>
          ) : null}
        </View>
        <View style={styles.lock}>
          <Icon name="lock-outline" size={14} color={colors.muted} />
          <AppText variant="small">Read-only</AppText>
        </View>
      </View>
      <View style={styles.grid}>
        {rows.map(([k, v]) => (
          <View key={k} style={styles.cell}>
            <AppText variant="small">{k}</AppText>
            <AppText variant="body">{v}</AppText>
          </View>
        ))}
      </View>
      <AppText variant="small">{note}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1, gap: spacing.xs },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  cell: { width: '45%', flexGrow: 1, gap: 2 },
});
