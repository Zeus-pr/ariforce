import type { Dcr } from '@ariforce/contracts';
import { Pressable, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Icon } from '@/components/icon';
import { SkeletonCard } from '@/components/skeleton';
import type { FlowState } from '@/lib/dcr/model';
import { colors } from '@/theme';
import { dcrStyles, Errors } from './field';
import { candidateFacts, SfcRouteCard } from './sfc-route-card';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

/** SFC / TA·DA of a field day (web dcr-sections SfcSection): route per HQ, read-only facts. */
export function SfcSection({
  sfc,
  routeChoice,
  readOnly,
  dcr,
  errors,
  onChooseRoute,
}: {
  sfc: FlowState['sfc'];
  routeChoice: FlowState['routeChoice'];
  readOnly: boolean;
  dcr: Dcr | null;
  errors: string[];
  onChooseRoute: (hqTerritoryId: string) => void;
}) {
  return (
    <View style={dcrStyles.section}>
      <AppText variant="label">SFC / TA·DA</AppText>
      {sfc.state === 'loading' ? (
        <SkeletonCard lines={4} />
      ) : sfc.state === 'error' ? (
        <AppText variant="caption" style={dcrStyles.err}>
          SFC could not be loaded. Retry before submitting.
        </AppText>
      ) : sfc.state === 'no_match' ? (
        <AppText variant="caption" style={dcrStyles.err}>
          No matching SFC record. Change the territory or band.
        </AppText>
      ) : sfc.state === 'ok' ? (
        sfc.hqs.map((h) => {
          const picked = routeChoice[h.hqTerritoryId];
          const chosen =
            (picked && h.candidates.some((x) => x.id === picked) ? picked : h.autoSelectedId) ?? '';
          const c = h.candidates.find((x) => x.id === chosen);
          return (
            <View key={h.hqTerritoryId} style={dcrStyles.section}>
              {h.candidates.length > 1 && !readOnly ? (
                <View style={dcrStyles.field}>
                  <AppText variant="label">{h.hqName}: which route did you travel?</AppText>
                  <Pressable
                    onPress={() => onChooseRoute(h.hqTerritoryId)}
                    accessibilityRole="button"
                    accessibilityLabel={`${h.hqName} route: ${c ? `${c.fromPlace} to ${c.toPlace}` : 'not chosen'}`}
                    style={dcrStyles.select}
                  >
                    <AppText variant="body" style={[dcrStyles.selectText, !c && dcrStyles.ph]}>
                      {c ? `${c.fromPlace} to ${c.toPlace}` : 'Choose your route'}
                    </AppText>
                    <Icon name="chevron-down" color={colors.subtle} />
                  </Pressable>
                </View>
              ) : null}
              {c ? (
                <SfcRouteCard
                  title={`${h.hqName} · ${c.fromPlace} to ${c.toPlace}`}
                  facts={candidateFacts(c)}
                  note="From your SFC. Read-only; changes are made on the SFC screen."
                />
              ) : (
                <AppText variant="bodyMuted">Pick a route to see its TA/DA.</AppText>
              )}
            </View>
          );
        })
      ) : dcr?.sfcRoutes?.length && readOnly ? (
        dcr.sfcRoutes.map((r) =>
          r.snapshot ? (
            <SfcRouteCard
              key={r.hqTerritoryId}
              title={`${r.snapshot.fromPlace} to ${r.snapshot.toPlace}`}
              facts={{
                fromPlace: r.snapshot.fromPlace,
                toPlace: r.snapshot.toPlace,
                oneWayKm: r.snapshot.oneWayKm,
                bothWayKm: r.snapshot.bothWayKm,
                oneWayAmount: r.snapshot.oneWayAmount,
                bothWayAmount: r.snapshot.bothWayAmount,
                actualFare: r.snapshot.actualFare,
                travelMode: r.snapshot.travelMode,
                category: r.snapshot.category,
                band: r.snapshot.band,
                da: r.snapshot.da,
                source: r.snapshot.source,
                ratePerKm: r.snapshot.ratePerKm,
              }}
              note={`Frozen at submit · TA rate ${inr.format(r.snapshot.ratePerKm)}/km`}
            />
          ) : null,
        )
      ) : null}
      <Errors list={errors} />
    </View>
  );
}
