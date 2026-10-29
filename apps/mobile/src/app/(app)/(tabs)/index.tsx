import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScrollView } from '@/components/scroll';
import { RefreshBar, pullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Chip } from '@/components/chip';
import { ApprovalsCard } from '@/components/home/approvals-card';
import { AttentionList } from '@/components/home/attention-list';
import { DoctorsToday } from '@/components/home/doctors-today';
import { KpiGrid } from '@/components/home/kpi-grid';
import { QuickActions } from '@/components/home/quick-actions';
import { TodayCard } from '@/components/home/today-card';
import { useAuth } from '@/lib/auth-context';
import { featureHref, type FeatureKey } from '@/lib/features';
import { formatDate, greeting } from '@/lib/format';
import { isApprover } from '@/lib/roles';
import { getHomeMock, HOME_IS_PLACEHOLDER } from '@/mocks/home';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { colors, layout, spacing } from '@/theme';

/**
 * Rep home, top to bottom in the order the day needs it:
 * greeting → today (punch, tour plan, DCR) → flags → quick actions → approvals (managers) →
 * doctors to visit → this month's KPIs. Everything but the user comes from src/mocks/home.ts.
 */
export default function HomeScreen() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const bottom = useBottomSpace();

  // Keep the greeting and date right if the app stays open across noon, 5 pm or midnight.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const day = now.toDateString();
  // PLACEHOLDER: one sample per calendar day (see src/mocks/home.ts).
  const data = useMemo(() => getHomeMock(new Date(day)), [day]);

  const name = user?.name?.trim() || user?.email || 'there';
  const approver = isApprover(user?.roles ?? []);
  const roles = user?.roles;
  const open = useCallback(
    (f: FeatureKey) => router.push(featureHref(f, roles ?? [])),
    [router, roles],
  );

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setNow(new Date());
    setRefreshing(false);
  }

  return (
    <TabScene>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        refreshControl={pullToRefresh(refreshing, onRefresh)}
      >
        <RefreshBar active={refreshing} />
        {/* Top band: continues the header's sky colour edge to edge (status bar icons stay dark). */}
        <View style={styles.band}>
          <AppText variant="greeting" style={styles.onSky}>
            {greeting(now)},
          </AppText>
          <AppText variant="name" accessibilityRole="header" numberOfLines={2}>
            {name}
          </AppText>
          <View style={styles.dateRow}>
            <AppText variant="caption" style={styles.onSky}>
              {formatDate(now)}
            </AppText>
            {HOME_IS_PLACEHOLDER ? <Chip label="Sample data" tone="orange" /> : null}
          </View>
        </View>

        <View style={styles.section}>
          <TodayCard key={day} data={data} onOpen={open} />
        </View>

        {data.attention.length > 0 ? (
          <View style={styles.section}>
            <AttentionList items={data.attention} onOpen={open} />
          </View>
        ) : null}

        <View style={styles.section}>
          <QuickActions onOpen={open} roles={user?.roles ?? []} />
        </View>

        {approver ? (
          <View style={styles.section}>
            <ApprovalsCard counts={data.approvals} onOpen={() => open('approvals')} />
          </View>
        ) : null}

        <View style={styles.section}>
          <DoctorsToday doctors={data.doctorsToday} onOpenDoctors={() => open('doctors')} />
        </View>

        <View style={styles.section}>
          <KpiGrid kpis={data.kpis} />
        </View>
      </ScrollView>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  section: { marginTop: layout.section },
  band: {
    backgroundColor: colors.homeSky,
    marginHorizontal: -layout.gutter,
    marginTop: -spacing.sm,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    // Card-like bottom curve; the top stays square and flush with the header band.
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    borderCurve: 'continuous',
  },
  onSky: { color: colors.onSkyMuted },
});
