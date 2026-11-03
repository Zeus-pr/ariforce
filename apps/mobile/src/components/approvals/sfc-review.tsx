import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { SfcRouteCard, candidateFacts } from '@/components/dcr/sfc-route-card';
import { SkeletonCard } from '@/components/skeleton';
import type { Dcr } from '@ariforce/contracts';
import { fetchSfcMatch } from '@/lib/dcr/api';
import type { TpItem } from '@/lib/tp/adapter';
import { spacing } from '@/theme';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

/** Frozen SFC snapshots from a submitted DCR (manager review). */
export function DcrSfcReview({ dcr }: { dcr: Dcr }) {
  const routes = (dcr.sfcRoutes ?? []).filter((r) => r.snapshot);
  if (!routes.length) return null;
  return (
    <Card style={styles.pad}>
      <AppText variant="label">SFC / TA·DA</AppText>
      {routes.map((r) => {
        const s = r.snapshot!;
        return (
          <SfcRouteCard
            key={r.hqTerritoryId}
            title={`${s.fromPlace} to ${s.toPlace}`}
            facts={{
              fromPlace: s.fromPlace,
              toPlace: s.toPlace,
              oneWayKm: s.oneWayKm,
              bothWayKm: s.bothWayKm,
              oneWayAmount: s.oneWayAmount,
              bothWayAmount: s.bothWayAmount,
              actualFare: s.actualFare,
              travelMode: s.travelMode,
              category: s.category,
              band: s.band,
              da: s.da,
              source: s.source,
              ratePerKm: s.ratePerKm,
            }}
            note={`Frozen at submit · TA rate ${inr.format(s.ratePerKm)}/km`}
          />
        );
      })}
    </Card>
  );
}

/** Live SFC match for a tour plan’s chosen routes (manager review). */
export function TpSfcReview({ item }: { item: TpItem }) {
  const { plan, from } = item;
  const q = useQuery({
    queryKey: ['tp-sfc-review', item.id, from, plan.workTypeId, plan.territoryIds.join(',')],
    enabled: !!plan.workTypeId && plan.territoryIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => fetchSfcMatch(from, plan.workTypeId, plan.territoryIds),
  });

  if (!plan.territoryIds.length) return null;

  if (q.isPending) {
    return (
      <Card style={styles.pad}>
        <AppText variant="label">SFC / TA·DA</AppText>
        <SkeletonCard lines={4} />
      </Card>
    );
  }

  if (!q.data || !('hqs' in q.data) || !q.data.hqs?.length) {
    return (
      <Card style={styles.pad}>
        <AppText variant="label">SFC / TA·DA</AppText>
        <AppText variant="bodyMuted">
          {plan.sfcRoutes.length
            ? `${plan.sfcRoutes.length} route${plan.sfcRoutes.length === 1 ? '' : 's'} chosen — details unavailable.`
            : 'No SFC routes on this plan.'}
        </AppText>
      </Card>
    );
  }

  const chosen = new Set(plan.sfcRoutes.map((r) => r.sfcRouteId));
  const cards = q.data.hqs.flatMap((h) => {
    const pick =
      h.candidates.find((c) => chosen.has(c.id)) ??
      h.candidates.find((c) => c.id === h.autoSelectedId) ??
      h.candidates[0];
    if (!pick) return [];
    return [
      <SfcRouteCard
        key={h.hqTerritoryId}
        title={`${h.hqName} · ${pick.fromPlace} to ${pick.toPlace}`}
        facts={candidateFacts(pick)}
        note="From the rep’s SFC choice at plan time."
      />,
    ];
  });

  return (
    <Card style={styles.pad}>
      <AppText variant="label">SFC / TA·DA</AppText>
      <View style={styles.stack}>{cards}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.sm },
  stack: { gap: spacing.sm },
});
