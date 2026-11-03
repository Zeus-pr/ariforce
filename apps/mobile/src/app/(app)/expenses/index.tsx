import type { Dcr } from '@ariforce/contracts';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { TrailDots } from '@/components/expenses/approval-trail';
import { FloatingFab, useFabScrollPad } from '@/components/floating-fab';
import { ListRow } from '@/components/list-row';
import { PullToRefresh } from '@/components/refresh';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useSubmittedHistory } from '@/lib/dcr/api';
import { monthStartIST, todayIST } from '@/lib/dcr/dates';
import {
  STATUS_LABEL,
  STATUS_TONE,
  type Claim,
  type ClaimSummary,
  claimDcrRejected,
  dcrDays,
  ensureExpenseDraft,
  expenseMessage,
  monthLabel,
  monthOf,
  useMyClaims,
} from '@/lib/expenses';
import { formatINR } from '@/lib/money';
import { colors, fonts, layout, spacing } from '@/theme';

const prevMonthStart = () => {
  const d = new Date(`${monthStartIST()}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};

/** Expenses list: grouped by month, status chips, a Needs-attention row and one New expense action. */
export default function ExpensesScreen() {
  const router = useRouter();
  const scrollPad = useFabScrollPad();
  const { user } = useAuth();
  const dcrsQ = useSubmittedHistory(prevMonthStart(), todayIST());
  const claimsQ = useMyClaims(user?.id);
  const dcrs: Dcr[] = useMemo(() => dcrsQ.data?.items ?? [], [dcrsQ.data]);
  const { counted, rejected } = useMemo(() => dcrDays(dcrs), [dcrs]);
  const months = useMemo(() => [...new Set([...counted.keys()].map(monthOf))].sort(), [counted]);

  // Client-side TA/DA sync from approved/submitted DCRs (unchanged behaviour).
  const syncQ = useQuery({
    queryKey: ['expenses', 'sync', months, rejected],
    enabled: dcrsQ.isSuccess,
    staleTime: 60_000,
    queryFn: async () => {
      const out: Record<string, Claim | null> = {};
      for (const m of months) {
        const monthDcrs = [...counted.values()].filter((d) => monthOf(d.date) === m);
        out[m] = await ensureExpenseDraft(`${m}-01`, rejected, monthDcrs);
      }
      void claimsQ.refetch();
      return out;
    },
  });

  const rejectedSet = new Set(rejected);
  const flagged = (c: ClaimSummary) =>
    claimDcrRejected(c, () => {
      const full = Object.values(syncQ.data ?? {}).find((x) => x?.id === c.id);
      return !!full?.lines.some((l) => l.dcrId && rejectedSet.has(l.dcrId));
    });

  const list = useMemo(
    () => [...(claimsQ.data ?? [])].sort((a, b) => b.month.localeCompare(a.month)),
    [claimsQ.data],
  );
  const attention = list.filter((c) => c.status === 'rejected' || flagged(c));
  const byYear = useMemo(() => {
    const m = new Map<string, ClaimSummary[]>();
    for (const c of list) m.set(c.month.slice(0, 4), [...(m.get(c.month.slice(0, 4)) ?? []), c]);
    return [...m.entries()];
  }, [list]);
  const open = list.filter((c) => c.status !== 'paid').reduce((s, c) => s + c.total, 0);

  const openClaim = (id: string) => router.push({ pathname: '/expenses/[id]', params: { id } });

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Expenses' }} />
      <PullToRefresh onRefresh={() => Promise.all([dcrsQ.refetch(), syncQ.refetch()])}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: scrollPad }]}
        >
          <Card style={styles.totals}>
            <View style={styles.flex}>
              <AppText variant="small">Not yet paid</AppText>
              <AppText variant="headline" style={styles.navy}>
                {formatINR(open)}
              </AppText>
            </View>
            <View style={styles.flex}>
              <AppText variant="small">Months</AppText>
              <AppText variant="headline">{list.length}</AppText>
            </View>
          </Card>

          {attention.length ? (
            <Card>
              {attention.map((c, i) => (
                <ListRow
                  key={c.id}
                  icon="alert-circle-outline"
                  tone="red"
                  title={`Needs attention · ${monthLabel(c.month)}`}
                  subtitle={
                    c.status === 'rejected' ? 'Rejected — fix and resubmit' : 'A DCR was rejected'
                  }
                  divider={i > 0}
                  onPress={() => openClaim(c.id)}
                />
              ))}
            </Card>
          ) : null}

          {claimsQ.isPending ? (
            <SkeletonList count={3} />
          ) : claimsQ.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">{expenseMessage(claimsQ.error)}</AppText>
            </Card>
          ) : !list.length ? (
            <Card style={styles.pad}>
              <AppText variant="body">No expenses yet</AppText>
            </Card>
          ) : (
            byYear.map(([year, claims]) => (
              <View key={year} style={styles.group}>
                <AppText variant="label" style={styles.year}>
                  {year}
                </AppText>
                <Card>
                  {claims.map((c, i) => (
                    <ListRow
                      key={c.id}
                      icon="receipt"
                      tone={STATUS_TONE[c.status] === 'slate' ? 'neutral' : 'teal'}
                      title={monthLabel(c.month)}
                      subtitle={`${formatINR(c.total)} · ${c.lineCount} items`}
                      trailing={
                        <View style={styles.trailing}>
                          <Chip label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />
                          <TrailDots claim={c} />
                        </View>
                      }
                      divider={i > 0}
                      onPress={() => openClaim(c.id)}
                    />
                  ))}
                </Card>
              </View>
            ))
          )}
          {syncQ.isError ? (
            <AppText variant="caption" style={styles.err}>
              {expenseMessage(syncQ.error)}
            </AppText>
          ) : null}
        </ScrollView>
      </PullToRefresh>
      <FloatingFab label="New expense" onPress={() => router.push('/expenses/new')} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: layout.gutter, gap: spacing.lg },
  pad: { padding: spacing.lg },
  totals: { flexDirection: 'row', padding: spacing.lg, gap: spacing.md },
  navy: { color: colors.brandNavyCore },
  group: { gap: spacing.sm },
  year: { color: colors.muted, fontFamily: fonts.semibold },
  trailing: { alignItems: 'flex-end', gap: spacing.xs },
  err: { color: colors.danger },
});
