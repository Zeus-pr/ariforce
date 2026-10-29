import { Redirect, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { TabScene, useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useDcrOptions } from '@/lib/dcr/api';
import { todayIST } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { normaliseWorkTypes } from '@/lib/dcr/model';
import { isSalesRole } from '@/lib/roles';
import { CONTRACT, TP_LABEL, TP_TONE, rangeLabel, useMyTps } from '@/lib/tp/adapter';
import { colors, layout, radius, shadows, spacing, touch } from '@/theme';

/** Tour plans: my one-day or from-to plans with their approval status, and New TP. */
export default function TourPlanTab() {
  const { user } = useAuth();
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
  return <TourPlans myId={user?.id} />;
}

function TourPlans({ myId }: { myId?: string }) {
  const router = useRouter();
  const bottom = useBottomSpace();
  const q = useMyTps(myId);
  const optionsQ = useDcrOptions(todayIST());
  const wtName = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of normaliseWorkTypes(optionsQ.data?.workTypes ?? [])) m.set(w.id, w.name);
    return m;
  }, [optionsQ.data]);
  const items = q.data ?? [];

  return (
    <TabScene>
      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: bottom + touch.control + spacing.lg },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={q.isRefetching && !q.isPending}
              onRefresh={() => void q.refetch()}
              tintColor={colors.navy}
              colors={[colors.navy]}
            />
          }
        >
          <View style={styles.head}>
            <AppText variant="small">
              {q.isPending ? 'Your tour plans' : `Your tour plans (${items.length})`}
            </AppText>
            {!CONTRACT.tpItems ? <Chip label="Sample mode" tone="orange" /> : null}
          </View>
          {q.isPending ? (
            <SkeletonList count={3} />
          ) : q.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">{saveMessage(q.error)}</AppText>
            </Card>
          ) : !items.length ? (
            <Card style={styles.pad}>
              <AppText variant="body">No tour plans yet</AppText>
              <AppText variant="bodyMuted">
                Plan a day or a few days with New TP, then send it to your manager. Approved plans
                show on the DCR screen, ready to file.
              </AppText>
            </Card>
          ) : (
            <Card>
              {items.map((t, i) => (
                <ListRow
                  key={t.id}
                  icon="calendar-month-outline"
                  tone={t.status === 'rejected' ? 'red' : 'blue'}
                  title={`TP · ${rangeLabel(t.from, t.to)}`}
                  subtitle={
                    t.status === 'rejected'
                      ? `Rejected: ${t.rejectionReason || 'no reason given'}`
                      : (wtName.get(t.plan.workTypeId) ?? 'Planned day')
                  }
                  trailing={<Chip label={TP_LABEL[t.status]} tone={TP_TONE[t.status]} />}
                  onPress={() => router.push({ pathname: '/tour-plan/form', params: { id: t.id } })}
                  divider={i < items.length - 1}
                />
              ))}
            </Card>
          )}
        </ScrollView>
        <Pressable
          onPress={() => router.push('/tour-plan/form')}
          accessibilityRole="button"
          accessibilityLabel="New tour plan"
          style={({ pressed }) => [
            styles.fab,
            { bottom: bottom + spacing.lg },
            pressed && styles.fabPressed,
          ]}
        >
          <Icon name="plus" color={colors.onNavy} />
          <AppText variant="button" style={styles.fabText}>
            New TP
          </AppText>
        </Pressable>
      </View>
    </TabScene>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pad: { padding: spacing.lg, gap: spacing.sm },
  fab: {
    position: 'absolute',
    right: layout.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: touch.control,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    backgroundColor: colors.navy,
    boxShadow: shadows.floating,
  },
  fabPressed: { backgroundColor: colors.navyPressed },
  fabText: { color: colors.onNavy },
});
