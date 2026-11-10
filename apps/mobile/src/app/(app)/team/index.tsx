import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { KpiReport } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { GrowBar } from '@/components/figures';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { MonthPager } from '@/components/month-pager';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { KPI_LABEL, formatKpi, monthKey } from '@/lib/perf';
import { isApprover } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

type Territory = { id: string; name: string; parentId: string | null };
const LIST_KPIS = ['coverage_pct', 'call_average', 'dcr_compliance_pct'] as const;
const PERSON_KPIS = [
  'coverage_pct',
  'call_average',
  'dcr_compliance_pct',
  'tp_adherence_pct',
  'missed_doctor_pct',
] as const;

async function loadTerritories() {
  const items: Territory[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < 8; n++) {
    const page = await apiFetch<{ items: Territory[]; nextCursor?: string | null }>(
      '/v1/territories',
      { query: { limit: 200, ...(cursor ? { cursor } : {}) } },
    );
    items.push(...(page.items ?? []));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

export default function TeamScreen() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const bottom = useBottomSpace();
  const [month, setMonth] = useState(() => monthKey());
  const [path, setPath] = useState<string[]>([]);
  const [personId, setPersonId] = useState<string | null>(null);
  const boot = useQuery({
    queryKey: ['team', 'territories'],
    enabled: isApprover(roles),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [territories, me] = await Promise.all([
        loadTerritories(),
        apiFetch<{ territoryIds?: string[] }>('/v1/me'),
      ]);
      const own = territories.find((t) => me.territoryIds?.includes(t.id));
      const root = territories.find((t) => t.parentId == null) ?? null;
      const home = roles.includes('director') || !own ? root : own;
      return { territories, home };
    },
  });
  const home = boot.data?.home ?? null;
  const currentId = path.at(-1) ?? home?.id ?? null;
  const current = boot.data?.territories?.find((t) => t.id === currentId) ?? null;
  const leaf = !!current && !boot.data?.territories?.some((t) => t.parentId === current.id);
  const rows = useQuery({
    queryKey: ['team', 'rows', month, currentId, leaf],
    enabled: !!currentId,
    staleTime: 60_000,
    queryFn: async () => {
      const report = await apiFetch<KpiReport>('/v1/kpis', {
        query: {
          month,
          rollup: leaf ? 'byUser' : 'byTerritory',
          territoryId: currentId!,
          kpis: LIST_KPIS.join(','),
        },
      });
      return report.rows.filter((r) => leaf || r.territoryId !== currentId);
    },
  });
  const person = useQuery({
    queryKey: ['team', 'person', month, personId],
    enabled: !!personId,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await apiFetch<KpiReport>('/v1/kpis', {
          query: { month, rollup: 'self', userId: personId!, kpis: PERSON_KPIS.join(',') },
        })
      ).rows[0] ?? null,
  });
  if (!isApprover(roles)) return <Redirect href="/" />;
  const chain = [
    home?.name,
    ...path.map((id) => boot.data?.territories?.find((t) => t.id === id)?.name),
  ].filter((name): name is string => !!name);
  const parentName = chain.length > 1 ? chain[chain.length - 2] : null;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Team' }} />
      <PullToRefresh
        onRefresh={() => Promise.all([boot.refetch(), rows.refetch(), person.refetch()])}
      >
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
          <View style={styles.heading}>
            <MonthPager month={month} onChange={setMonth} />
            {parentName ? (
              <Pressable
                onPress={() => {
                  setPath((p) => p.slice(0, -1));
                  setPersonId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Up to ${parentName}`}
                style={styles.trail}
              >
                <AppText variant="small" style={styles.up}>
                  {chain.slice(0, -1).join(' · ')}
                </AppText>
                <AppText variant="small"> · {chain.at(-1)}</AppText>
              </Pressable>
            ) : (
              <AppText variant="small">{current?.name ?? 'Team'}</AppText>
            )}
          </View>

          {boot.isPending || rows.isPending ? (
            <SkeletonList count={4} />
          ) : boot.isError || rows.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">Could not load the team. Pull to try again.</AppText>
            </Card>
          ) : !rows.data?.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">
                Nothing under {current?.name ?? 'here'} this month.
              </AppText>
            </Card>
          ) : (
            <Card>
              {rows.data.map((r) => {
                const coverage = r.metrics.find((m) => m.kpi === 'coverage_pct');
                const share =
                  coverage?.value == null ? 0 : Math.max(0, Math.min(1, coverage.value / 100));
                const lead =
                  coverage?.value != null &&
                  coverage.value > 0 &&
                  coverage.value ===
                    Math.max(
                      ...(rows.data ?? []).map(
                        (row) => row.metrics.find((m) => m.kpi === 'coverage_pct')?.value ?? 0,
                      ),
                    );
                const open = leaf && personId === r.userId;
                return (
                  <View key={r.userId ?? r.territoryId ?? r.label}>
                    <Pressable
                      onPress={() => {
                        if (!leaf && r.territoryId) {
                          setPath((p) => [...p, r.territoryId!]);
                          setPersonId(null);
                        } else if (r.userId) {
                          setPersonId((id) => (id === r.userId ? null : r.userId));
                        }
                      }}
                      accessibilityRole="button"
                      style={styles.row}
                    >
                      <GrowBar share={share} lead={lead} />
                      <View style={styles.copy}>
                        <AppText variant="label" numberOfLines={1}>
                          {r.label}
                        </AppText>
                        <AppText variant="small">Coverage</AppText>
                      </View>
                      <AppText variant="label">
                        {coverage ? formatKpi(coverage.unit, coverage.value) : '—'}
                      </AppText>
                      {leaf ? null : <Icon name="chevron-right" size={18} color={colors.subtle} />}
                    </Pressable>
                    {open ? (
                      person.isPending ? (
                        <View style={styles.pad}>
                          <AppText variant="bodyMuted">Loading…</AppText>
                        </View>
                      ) : (
                        PERSON_KPIS.map((key) => {
                          const m = person.data?.metrics?.find((x) => x.kpi === key);
                          return (
                            <View key={key} style={styles.metric}>
                              <AppText variant="small" style={styles.copy}>
                                {KPI_LABEL[key]}
                              </AppText>
                              <AppText variant="label">
                                {m ? formatKpi(m.unit, m.value) : '—'}
                              </AppText>
                            </View>
                          );
                        })
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
  heading: { alignItems: 'center', gap: spacing.xs },
  trail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 32 },
  up: { color: colors.tealDeep },
  pad: { padding: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  copy: { flex: 1, gap: 2 },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.xl,
    paddingRight: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
