import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ProductKpiReport } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { GrowBar } from '@/components/figures';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { MonthPager } from '@/components/month-pager';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { formatINR } from '@/lib/money';
import { kpiRollup, monthKey } from '@/lib/perf';
import { isSalesRole } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

export default function ProductReportScreen() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const bottom = useBottomSpace();
  const [month, setMonth] = useState(() => monthKey());
  const rollup = kpiRollup(roles);
  const q = useQuery({
    queryKey: ['kpis', 'products', month, rollup],
    enabled: isSalesRole(roles),
    staleTime: 60_000,
    queryFn: () => apiFetch<ProductKpiReport>('/v1/kpis/products', { query: { month, rollup } }),
  });
  if (!isSalesRole(roles)) return <Redirect href="/" />;
  const rows = q.data?.rows ?? [];
  const maxCalls = Math.max(0, ...rows.map((p) => p.detailedCalls));
  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Product detailing' }} />
      <PullToRefresh onRefresh={() => q.refetch()}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
          <MonthPager month={month} onChange={setMonth} />
          {q.isPending ? (
            <SkeletonList count={5} />
          ) : q.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">Could not load products. Pull to try again.</AppText>
            </Card>
          ) : !rows.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">No detailing recorded this month.</AppText>
            </Card>
          ) : (
            <Card>
              {rows.map((p, i) => {
                const share = maxCalls ? p.detailedCalls / maxCalls : 0;
                const lead = p.detailedCalls > 0 && p.detailedCalls === maxCalls;
                return (
                  <View
                    key={p.productId}
                    style={[styles.row, i < rows.length - 1 && styles.divider]}
                  >
                    <GrowBar share={share} lead={lead} index={i} />
                    <View style={styles.copy}>
                      <AppText variant="label" numberOfLines={2}>
                        {p.productName}
                      </AppText>
                      <AppText variant="small">
                        {p.detailedCalls} detailed
                        {p.sampleQty ? ` · ${p.sampleQty} samples` : ''}
                      </AppText>
                    </View>
                    <AppText variant="label">{p.pobValue ? formatINR(p.pobValue) : '—'}</AppText>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  copy: { flex: 1, gap: 2 },
});
