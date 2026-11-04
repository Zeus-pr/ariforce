import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScrollView } from '@/components/scroll';
import { PullToRefresh } from '@/components/refresh';
import { ApprovalsCard } from '@/components/home/approvals-card';
import { AttentionList } from '@/components/home/attention-list';
import { CanopyHero } from '@/components/home/canopy-hero';
import { KpiGrid } from '@/components/home/kpi-grid';
import { BusinessTiles } from '@/components/home/business-tiles';
import { QuickActions } from '@/components/home/quick-actions';
import { ScheduleToday } from '@/components/home/schedule-today';
import { SyncStrip } from '@/components/home/sync-strip';
import { useAuth } from '@/lib/auth-context';
import { featureHref, type FeatureKey } from '@/lib/features';
import { useHomeAttention } from '@/lib/home-attention';
import { isApprover, roleLabel } from '@/lib/roles';
import { getHomeMock } from '@/mocks/home';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { colors, layout, radius, spacing } from '@/theme';

/**
 * Stitch Field Command home: canopy → quick actions → business masters → attention →
 * schedule → KPIs → sync stub. User identity from auth; everything else from mocks/home.
 */
export default function HomeScreen() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const bottom = useBottomSpace();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const day = now.toDateString();
  const data = useMemo(() => getHomeMock(new Date(day)), [day]);

  const name = user?.name?.trim() || user?.email || 'there';
  const role = roleLabel(user?.roles ?? []);
  const approver = isApprover(user?.roles ?? []);
  const attention = useHomeAttention(user);
  const roles = user?.roles;
  const open = useCallback(
    (f: FeatureKey) => router.push(featureHref(f, roles ?? [])),
    [router, roles],
  );

  async function onRefresh() {
    await Promise.all([refresh(), attention.refetch()]);
    setNow(new Date());
  }

  return (
    <TabScene>
      <PullToRefresh onRefresh={onRefresh}>
        <ScrollView
          overScrollMode="auto"
          bounces
          alwaysBounceVertical
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        >
          <CanopyHero name={name} role={role} now={now} />

          <View style={styles.sheet}>
            <QuickActions onOpen={open} roles={user?.roles ?? []} hints={data.quickHints} />

            <View style={styles.section}>
              <BusinessTiles onOpen={open} roles={user?.roles ?? []} />
            </View>

            <View style={styles.section}>
              <AttentionList items={attention.items} pending={attention.pending} />
            </View>

            {approver ? (
              <View style={styles.section}>
                <ApprovalsCard counts={attention.counts} onOpen={() => open('approvals')} />
              </View>
            ) : null}

            <View style={styles.section}>
              <ScheduleToday items={data.doctorsToday} onFullRoute={() => open('tour-plan')} />
            </View>

            <View style={styles.section}>
              <KpiGrid kpis={data.kpis} />
            </View>

            <View style={styles.section}>
              <SyncStrip label={data.offlineCache.label} />
            </View>
          </View>
        </ScrollView>
      </PullToRefresh>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  content: { paddingHorizontal: layout.gutter, paddingTop: 0 },
  sheet: {
    // Full-bleed under the canopy so rounded corners don’t leave a white gap
    // at the screen edges below the teal band.
    marginHorizontal: -layout.gutter,
    marginTop: -spacing.lg,
    paddingHorizontal: layout.gutter,
    backgroundColor: colors.ground,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderCurve: 'continuous',
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    gap: 0,
  },
  section: { marginTop: layout.section },
});
