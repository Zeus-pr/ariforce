import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { SfcEmployee, SfcHq, SfcTable } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { formatINR } from '@/lib/money';
import { canViewTeamField, roleLabel } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

export default function SfcScreen() {
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const [hqId, setHqId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const allowed = canViewTeamField(user?.roles ?? []);
  const hqs = useQuery({
    queryKey: ['sfc', 'hqs'],
    enabled: allowed,
    staleTime: 60_000,
    queryFn: () => apiFetch<{ items: SfcHq[] }>('/v1/sfc/hqs').then((r) => r.items ?? []),
  });
  const people = useQuery({
    queryKey: ['sfc', 'people', hqId],
    enabled: !!hqId,
    queryFn: () =>
      apiFetch<{ items: SfcEmployee[] }>('/v1/sfc/employees', {
        query: { territoryId: hqId! },
      }).then((r) => r.items ?? []),
  });
  const table = useQuery({
    queryKey: ['sfc', 'routes', userId],
    enabled: !!userId,
    queryFn: () => apiFetch<SfcTable>(`/v1/sfc/employees/${userId}/routes`),
  });
  if (!allowed) return <Redirect href="/" />;
  const hq = hqs.data?.find((h) => h.id === hqId);

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'SFC' }} />
      <PullToRefresh
        onRefresh={() => Promise.all([hqs.refetch(), people.refetch(), table.refetch()])}
      >
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
          {hq ? (
            <Pressable
              onPress={() => {
                setHqId(null);
                setUserId(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="All headquarters"
              style={styles.up}
            >
              <AppText variant="label" style={styles.upLabel}>
                All headquarters
              </AppText>
              <AppText variant="small"> · {hq.name}</AppText>
            </Pressable>
          ) : null}

          {!hqId ? (
            hqs.isPending ? (
              <SkeletonList count={5} />
            ) : hqs.isError ? (
              <Card style={styles.pad}>
                <AppText variant="bodyMuted">
                  Could not load headquarters. Pull to try again.
                </AppText>
              </Card>
            ) : !hqs.data?.length ? (
              <Card style={styles.pad}>
                <AppText variant="bodyMuted">No headquarters in your scope.</AppText>
              </Card>
            ) : (
              <Card>
                {hqs.data.map((h, i) => (
                  <Pressable
                    key={h.id}
                    onPress={() => setHqId(h.id)}
                    accessibilityRole="button"
                    style={[styles.row, i < hqs.data.length - 1 && styles.divider]}
                  >
                    <View style={styles.copy}>
                      <AppText variant="label" numberOfLines={1}>
                        {h.name}
                      </AppText>
                      <AppText variant="small">
                        {h.employeeCount} people · {h.routeCount} routes
                      </AppText>
                    </View>
                    <Icon name="chevron-right" size={20} color={colors.subtle} />
                  </Pressable>
                ))}
              </Card>
            )
          ) : people.isPending ? (
            <SkeletonList count={4} />
          ) : people.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">Could not load people at {hq?.name}.</AppText>
            </Card>
          ) : (
            <Card>
              {(people.data ?? []).map((p) => {
                const on = userId === p.id;
                return (
                  <View key={p.id}>
                    <Pressable
                      onPress={() => setUserId((id) => (id === p.id ? null : p.id))}
                      accessibilityRole="button"
                      style={styles.row}
                    >
                      <View style={styles.copy}>
                        <AppText variant="label" numberOfLines={1}>
                          {p.name}
                        </AppText>
                        <AppText variant="small">
                          {p.role ? roleLabel([p.role]) : 'No role'} · {p.routeCount} routes
                        </AppText>
                      </View>
                      <Icon
                        name={on ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={colors.subtle}
                      />
                    </Pressable>
                    {on ? (
                      table.isPending ? (
                        <View style={styles.pad}>
                          <AppText variant="bodyMuted">Loading routes…</AppText>
                        </View>
                      ) : table.isError ? (
                        <View style={styles.pad}>
                          <AppText variant="bodyMuted">Could not load this chart.</AppText>
                        </View>
                      ) : !table.data?.routes?.length ? (
                        <View style={styles.pad}>
                          <AppText variant="bodyMuted">No routes saved.</AppText>
                        </View>
                      ) : (
                        table.data.routes.map((route) => (
                          <View key={route.id} style={styles.route}>
                            <AppText variant="label">
                              {route.fromPlace} to {route.toPlace}
                            </AppText>
                            <AppText variant="small">
                              {route.oneWayKm} km
                              {route.oneWayAmount != null
                                ? ` · ${formatINR(route.oneWayAmount)}`
                                : ' · actual fare'}
                            </AppText>
                          </View>
                        ))
                      )
                    ) : null}
                  </View>
                );
              })}
            </Card>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.lg, gap: spacing.lg },
  pad: { padding: spacing.lg },
  up: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  upLabel: { color: colors.tealDeep },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  copy: { flex: 1, gap: 2 },
  route: {
    paddingLeft: spacing.xl,
    paddingRight: spacing.lg,
    paddingBottom: spacing.md,
    gap: 2,
  },
});
