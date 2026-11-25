import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { SfcRouteCard, candidateFacts } from '@/components/dcr/sfc-route-card';
import { SkeletonCard } from '@/components/skeleton';
import type { Dcr } from '@ariforce/contracts';
import { fetchSfcMatch } from '@/lib/dcr/api';
import type { TpItem, TpRouteFact } from '@/lib/tp/adapter';
import { CATEGORY_BAND, sfcCategoryOf } from '@/lib/dcr/bands';
import { spacing } from '@/theme';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

/** Frozen SFC snapshots from a submitted DCR (manager review). */
export function DcrSfcReview({
  dcr,
  routes: given,
  embedded,
}: {
  dcr: Dcr;
  routes?: Dcr['sfcRoutes'];
  embedded?: boolean;
}) {
  const routes = (given ?? dcr.sfcRoutes ?? []).filter((r) => r.snapshot);
  if (!routes.length) return null;
  const cards = routes.map((r) => {
    const s = r.snapshot!;
    return (
      <SfcRouteCard
        key={r.sfcRouteId}
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
        note={`Both-way TA ${s.bothWayAmount == null ? '—' : inr.format(s.bothWayAmount)} · DA ${s.da == null ? '—' : inr.format(s.da)}`}
      />
    );
  });
  if (embedded) return <View style={styles.stack}>{cards}</View>;
  return (
    <Card style={styles.pad}>
      <AppText variant="label">SFC routes</AppText>
      {cards}
    </Card>
  );
}

/** Live SFC match for a tour plan’s chosen routes (manager review). */
export function TpSfcReview({
  item,
  workTypeId,
  territoryIds,
  sfcRoutes,
  embedded,
  filerFacts,
}: {
  item: TpItem;
  workTypeId?: string;
  territoryIds?: string[];
  sfcRoutes?: { sfcRouteId: string }[];
  embedded?: boolean;
  /** Set on someone else's plan. Never loads the signed-in person's chart. */
  filerFacts?: TpRouteFact[] | null;
}) {
  const work = workTypeId ?? item.plan.workTypeId;
  const places = territoryIds ?? item.plan.territoryIds;
  const routes = sfcRoutes ?? item.plan.sfcRoutes;
  if (filerFacts) {
    const chosen = routes.map((route) => route.sfcRouteId);
    const cards = chosen.flatMap((id) => {
      const fact = filerFacts.find((row) => row.id === id);
      if (!fact) return [];
      const cat = sfcCategoryOf(fact.category);
      return [
        <SfcRouteCard
          key={fact.id}
          title={`${fact.fromPlace} to ${fact.toPlace}`}
          facts={{
            fromPlace: fact.fromPlace,
            toPlace: fact.toPlace,
            oneWayKm: fact.oneWayKm,
            bothWayKm: fact.bothWayKm,
            oneWayAmount: fact.oneWayAmount,
            bothWayAmount: fact.bothWayAmount,
            actualFare: fact.actualFare,
            travelMode: fact.travelMode,
            category: fact.category,
            band: cat ? CATEGORY_BAND[cat] : null,
            da: fact.da,
            source: 'own',
          }}
          note="From the filer's SFC, saved on this plan."
        />,
      ];
    });
    const wrapFacts = (node: ReactNode) =>
      embedded ? <View style={styles.stack}>{node}</View> : <Card style={styles.pad}>{node}</Card>;
    return wrapFacts(
      <>
        <AppText variant="label">SFC routes</AppText>
        {cards.length ? (
          <View style={styles.stack}>{cards}</View>
        ) : (
          <AppText variant="bodyMuted">
            {chosen.length
              ? "This route's fare is on the filer's chart."
              : 'No SFC routes on this plan.'}
          </AppText>
        )}
      </>,
    );
  }
  const q = useQuery({
    queryKey: [
      'tp-sfc-review',
      item.id,
      item.from,
      work,
      places.join(','),
      routes.map((r) => r.sfcRouteId).join(','),
    ],
    enabled: !!work && places.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => fetchSfcMatch(item.from, work, places),
  });

  if (!places.length) return null;

  const wrap = (node: ReactNode) =>
    embedded ? <View style={styles.stack}>{node}</View> : <Card style={styles.pad}>{node}</Card>;

  if (q.isPending) {
    return wrap(
      <>
        <AppText variant="label">SFC routes</AppText>
        <SkeletonCard lines={4} />
      </>,
    );
  }

  if (!q.data || !('hqs' in q.data) || !q.data.hqs?.length) {
    return wrap(
      <>
        <AppText variant="label">SFC routes</AppText>
        <AppText variant="bodyMuted">
          {routes.length
            ? `${routes.length} route${routes.length === 1 ? '' : 's'} chosen. Details are unavailable.`
            : 'No SFC routes on this plan.'}
        </AppText>
      </>,
    );
  }

  const chosen = new Set(routes.map((r) => r.sfcRouteId));
  const cards = q.data.hqs.flatMap((h) => {
    const picks = h.candidates.filter((c) => chosen.has(c.id));
    const rows = picks.length
      ? picks
      : !chosen.size && h.autoSelectedId
        ? h.candidates.filter((c) => c.id === h.autoSelectedId)
        : [];
    return rows.map((pick) => (
      <SfcRouteCard
        key={pick.id}
        title={`${h.hqName} · ${pick.fromPlace} to ${pick.toPlace}`}
        facts={candidateFacts(pick)}
        note="Both-way TA is added. The day’s DA is the greatest of the selected routes."
      />
    ));
  });

  return wrap(
    <>
      <AppText variant="label">SFC routes</AppText>
      {cards.length ? (
        <View style={styles.stack}>{cards}</View>
      ) : (
        <AppText variant="bodyMuted">No SFC routes on this plan.</AppText>
      )}
    </>,
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.sm },
  stack: { gap: spacing.sm },
});
