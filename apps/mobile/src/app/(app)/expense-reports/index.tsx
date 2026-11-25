import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ExpenseStatus } from '@ariforce/contracts';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { MonthPager } from '@/components/month-pager';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/api';
import { STATUS_LABEL } from '@/lib/expenses';
import { formatINR } from '@/lib/money';
import { monthKey } from '@/lib/perf';
import { isSalesRole } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

type Report = {
  total: number;
  rows: {
    userId: string;
    userName: string;
    status: ExpenseStatus;
    total: number;
    claimedDays: number;
    matchedDays: number;
    unmatchedAmount: number;
  }[];
};

export default function ExpenseReportScreen() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const allowed = isSalesRole(roles) || roles.includes('system_admin');
  const bottom = useBottomSpace();
  const [month, setMonth] = useState(() => monthKey());
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['expense-report', month],
    enabled: allowed,
    staleTime: 60_000,
    queryFn: () => apiFetch<Report>('/v1/expense-reports', { query: { month } }),
  });
  if (!allowed) return <Redirect href="/" />;
  const rows = q.data?.rows ?? [];
  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Expense report' }} />
      <PullToRefresh onRefresh={() => q.refetch()}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]}>
          <MonthPager month={month} onChange={setMonth} />
          {q.isPending ? (
            <SkeletonList count={4} />
          ) : q.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">Could not load the report. Pull to try again.</AppText>
            </Card>
          ) : !rows.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">No claims this month.</AppText>
            </Card>
          ) : (
            <Card>
              <View style={styles.head}>
                <AppText variant="label">Total</AppText>
                <AppText variant="section">{formatINR(q.data?.total ?? 0)}</AppText>
              </View>
              {rows.map((r) => {
                const on = open === r.userId;
                return (
                  <View key={r.userId}>
                    <Pressable
                      onPress={() => setOpen((id) => (id === r.userId ? null : r.userId))}
                      accessibilityRole="button"
                      style={styles.row}
                    >
                      <View style={styles.copy}>
                        <AppText variant="label" numberOfLines={1}>
                          {r.userName}
                        </AppText>
                        <AppText variant="small">
                          {STATUS_LABEL[r.status]} · {formatINR(r.total)}
                        </AppText>
                      </View>
                      <Icon
                        name={on ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={colors.subtle}
                      />
                    </Pressable>
                    {on ? (
                      <View style={styles.detail}>
                        <AppText variant="small">
                          {r.claimedDays} claimed days · {r.matchedDays} match a DCR
                        </AppText>
                        {r.unmatchedAmount ? (
                          <AppText variant="small">
                            {formatINR(r.unmatchedAmount)} unmatched
                          </AppText>
                        ) : null}
                      </View>
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
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  copy: { flex: 1, gap: 2 },
  detail: { paddingLeft: spacing.xl, paddingRight: spacing.lg, paddingBottom: spacing.md, gap: 2 },
});
