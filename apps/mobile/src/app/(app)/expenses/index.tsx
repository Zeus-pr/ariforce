import type { Dcr } from '@ariforce/contracts';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { PullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { ListRow } from '@/components/list-row';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useSubmittedHistory } from '@/lib/dcr/api';
import { dateLabel, monthStartIST, todayIST } from '@/lib/dcr/dates';
import {
  STATUS_LABEL,
  STATUS_TONE,
  type Claim,
  dcrDays,
  claimDcrRejected,
  ensureExpenseDraft,
  serverDraftsExpense,
  expenseMessage,
  isEditable,
  monthLabel,
  monthOf,
  useMyClaims,
} from '@/lib/expenses';
import { formatINR } from '@/lib/money';
import { layout, spacing } from '@/theme';

const prevMonthStart = () => {
  const m = monthStartIST();
  const d = new Date(`${m}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Expenses: one draft card per submitted DCR day (TA/DA filled in) while that month's claim is
 * still open, then the claim history. Opening the screen re-syncs the TA/DA drafts (idempotent).
 */
export default function ExpensesScreen() {
  const router = useRouter();
  const bottom = useBottomSpace();
  const { user } = useAuth();
  const dcrsQ = useSubmittedHistory(prevMonthStart(), todayIST());
  const claimsQ = useMyClaims(user?.id);
  const dcrs: Dcr[] = useMemo(() => dcrsQ.data?.items ?? [], [dcrsQ.data]);
  const { counted, rejected } = useMemo(() => dcrDays(dcrs), [dcrs]);
  const months = useMemo(() => [...new Set([...counted.keys()].map(monthOf))].sort(), [counted]);

  // Ensure each month's draft (TA/DA for every counted day, none for rejected DCRs).
  const syncQ = useQuery({
    queryKey: ['expenses', 'sync', months, rejected],
    enabled: dcrsQ.isSuccess,
    staleTime: 60_000,
    queryFn: async () => {
      const out: Record<string, Claim | null> = {};
      if (await serverDraftsExpense()) {
        // The server drafts on submit and flags rejected days: just read the month claims.
        const list = await apiFetch<{ items: { id: string; month: string }[] }>(
          '/v1/expense-claims',
          { query: { userId: user?.id } },
        );
        for (const m of months) {
          const c = list.items.find((x) => x.month === m);
          out[m] = c ? await apiFetch<Claim>(`/v1/expense-claims/${c.id}`) : null;
        }
      } else for (const m of months) out[m] = await ensureExpenseDraft(`${m}-01`, rejected);
      void claimsQ.refetch();
      return out;
    },
  });

  const cards = useMemo(() => {
    const claims = syncQ.data ?? {};
    return [...counted.keys()]
      .filter((d) => {
        const c = claims[monthOf(d)];
        return !c || isEditable(c.status);
      })
      .sort((a, b) => b.localeCompare(a))
      .map((date) => {
        const c = claims[monthOf(date)];
        const lines = c?.lines.filter((l) => l.date === date) ?? [];
        const tada = lines.filter((l) => l.source === 'auto').reduce((s, l) => s + l.amount, 0);
        return { date, claim: c, tada, count: lines.length };
      });
  }, [counted, syncQ.data]);

  const rejectedSet = new Set(rejected);
  const flagged = (c: { id: string }) =>
    claimDcrRejected(c, () => {
      const full = Object.values(syncQ.data ?? {}).find((x) => x?.id === c.id);
      return !!full?.lines.some((l) => l.dcrId && rejectedSet.has(l.dcrId));
    });

  const loading = dcrsQ.isPending || claimsQ.isPending;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Expenses' }} />
      <PullToRefresh onRefresh={() => Promise.all([dcrsQ.refetch(), syncQ.refetch()])}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        >
          <AppText variant="small">Drafts from your DCRs</AppText>
          {loading || syncQ.isPending ? (
            <SkeletonList count={2} />
          ) : !cards.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">
                Submit a DCR and that day’s expense draft appears here with TA/DA filled in.
              </AppText>
            </Card>
          ) : (
            <Card>
              {cards.map((c, i) => (
                <ListRow
                  key={c.date}
                  icon="receipt"
                  tone="blue"
                  title={`Expense · ${dateLabel(c.date)}`}
                  subtitle={`TA/DA ${formatINR(c.tada)}${c.count ? ` · ${c.count} ${c.count === 1 ? 'line' : 'lines'}` : ''}`}
                  trailing={<Chip label="Draft" tone="blue" />}
                  divider={i > 0}
                  onPress={() =>
                    c.claim &&
                    router.push({
                      pathname: '/expenses/[id]',
                      params: { id: c.claim.id, date: c.date },
                    })
                  }
                />
              ))}
            </Card>
          )}
          {syncQ.isError ? (
            <AppText variant="caption">{expenseMessage(syncQ.error)}</AppText>
          ) : null}

          <AppText variant="small" style={styles.section}>
            Claims
          </AppText>
          {claimsQ.isPending ? (
            <SkeletonList count={3} />
          ) : claimsQ.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">{expenseMessage(claimsQ.error)}</AppText>
            </Card>
          ) : !claimsQ.data?.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">No expense claims yet.</AppText>
            </Card>
          ) : (
            <Card>
              {claimsQ.data.map((c, i) => (
                <ListRow
                  key={c.id}
                  icon="receipt"
                  tone={STATUS_TONE[c.status] === 'red' ? 'red' : 'teal'}
                  title={monthLabel(c.month)}
                  subtitle={`${formatINR(c.total)} · ${c.lineCount} ${c.lineCount === 1 ? 'line' : 'lines'}${c.rejectionReason && c.status === 'rejected' ? ` · ${c.rejectionReason}` : ''}`}
                  trailing={
                    <View style={styles.chips}>
                      {!isEditable(c.status) && flagged(c) ? (
                        <Chip label="DCR rejected" tone="red" />
                      ) : null}
                      <Chip label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />
                    </View>
                  }
                  divider={i > 0}
                  onPress={() => router.push({ pathname: '/expenses/[id]', params: { id: c.id } })}
                />
              ))}
            </Card>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  pad: { padding: spacing.lg },
  section: { marginTop: spacing.sm },
  chips: { alignItems: 'flex-end', gap: spacing.xs },
});
