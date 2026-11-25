import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlannedDoctors } from '@ariforce/contracts';
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
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { featureHref, type FeatureKey } from '@/lib/features';
import { useHomeAttention } from '@/lib/home-attention';
import { scheduleFromPlan } from '@/lib/home-schedule';
import { useHomeKpis } from '@/lib/home-kpis';
import { useMarkObserveInteractive } from '@/lib/observe';
import { isApprover, isSalesRole, roleLabel } from '@/lib/roles';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { colors, layout, radius, spacing } from '@/theme';

/**
 * Home: canopy, actions, attention, this month’s live KPIs, and today’s tour-plan doctors.
 */
export default function HomeScreen() {
  useMarkObserveInteractive();
  const { user, refresh } = useAuth();
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const bottom = useBottomSpace();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const schedule = useQuery({
    queryKey: ['me', 'planned-doctors'],
    queryFn: () => apiFetch<PlannedDoctors>('/v1/me/planned-doctors'),
    staleTime: 60_000,
  });
  const scheduleRows = useMemo(() => scheduleFromPlan(schedule.data?.items ?? []), [schedule.data]);

  const name = user?.name?.trim() || user?.email || 'there';
  const role = roleLabel(user?.roles ?? []);
  const approver = isApprover(user?.roles ?? []);
  const attention = useHomeAttention(user);
  const kpis = useHomeKpis(user?.roles ?? []);
  const roles = user?.roles;
  const open = useCallback(
    (f: FeatureKey) => router.push(featureHref(f, roles ?? [])),
    [router, roles],
  );

  async function onRefresh() {
    await Promise.all([refresh(), attention.refetch(), kpis.refetch(), schedule.refetch()]);
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
            <QuickActions onOpen={open} roles={user?.roles ?? []} />

            <View style={styles.section}>
              <BusinessTiles onOpen={open} roles={user?.roles ?? []} />
            </View>

            {attention.pending || attention.items.some((item) => item.id !== 'approvals') ? (
              <View style={styles.section}>
                <AttentionList items={attention.items} pending={attention.pending} />
              </View>
            ) : null}

            {approver ? (
              <View style={styles.section}>
                <ApprovalsCard counts={attention.counts} onOpen={() => open('approvals')} />
              </View>
            ) : null}

            <View style={styles.section}>
              <ScheduleToday
                items={scheduleRows}
                pending={schedule.isPending}
                error={schedule.isError}
                onFullRoute={() => open('tour-plan')}
              />
            </View>

            {isSalesRole(user?.roles ?? []) ? (
              <View style={styles.section}>
                <KpiGrid cards={kpis.cards} pending={kpis.pending} error={kpis.error} />
              </View>
            ) : null}
          </View>
        </ScrollView>
      </PullToRefresh>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  // Transparent so the tab watermark (TabScene) shows; the scene paints colors.ground.
  flex: { flex: 1 },
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
