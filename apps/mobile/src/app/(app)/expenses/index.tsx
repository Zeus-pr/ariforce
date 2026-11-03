import type { Dcr } from '@ariforce/contracts';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { PullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { FloatingFab, useFabScrollPad } from '@/components/floating-fab';
import { ListRow } from '@/components/list-row';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useSubmittedHistory } from '@/lib/dcr/api';
import { dateLabel, monthStartIST, todayIST } from '@/lib/dcr/dates';
import {
  STATUS_LABEL,
  STATUS_TONE,
  type Claim,
  type ClaimSummary,
  dcrDays,
  claimDcrRejected,
  ensureClaim,
  ensureExpenseDraft,
  expenseMessage,
  isEditable,
  monthLabel,
  monthOf,
  useMyClaims,
} from '@/lib/expenses';
import { formatINR } from '@/lib/money';
import { colors, fonts, layout, spacing } from '@/theme';

const prevMonthStart = () => {
  const m = monthStartIST();
  const d = new Date(`${m}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Expenses hub (TP/DCR-style): drafts from DCR days, claim list by status, New Expense FAB.
 * Statement fields live on the claim screen (auto TA/DA + manual boxes).
 */
export default function ExpensesScreen() {
  const router = useRouter();
  const scrollPad = useFabScrollPad();
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const dcrsQ = useSubmittedHistory(prevMonthStart(), todayIST());
  const claimsQ = useMyClaims(user?.id);
  const dcrs: Dcr[] = useMemo(() => dcrsQ.data?.items ?? [], [dcrsQ.data]);
  const { counted, rejected } = useMemo(() => dcrDays(dcrs), [dcrs]);
  const months = useMemo(() => [...new Set([...counted.keys()].map(monthOf))].sort(), [counted]);

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
        const tada = lines
          .filter(
            (l) =>
              l.source === 'auto' ||
              (l.notes ?? '').includes('[SFC TA]') ||
              (l.notes ?? '').includes('[SFC DA]'),
          )
          .reduce((s, l) => s + l.amount, 0);
        const extras = lines.reduce((s, l) => s + l.amount, 0) - tada;
        return { date, claim: c, tada, extras, count: lines.length };
      });
  }, [counted, syncQ.data]);

  const rejectedSet = new Set(rejected);
  const flagged = (c: { id: string }) =>
    claimDcrRejected(c, () => {
      const full = Object.values(syncQ.data ?? {}).find((x) => x?.id === c.id);
      return !!full?.lines.some((l) => l.dcrId && rejectedSet.has(l.dcrId));
    });

  const groups = useMemo(() => {
    const list = claimsQ.data ?? [];
    return {
      draft: list.filter((c) => c.status === 'draft' || c.status === 'rejected'),
      pending: list.filter((c) => c.status === 'submitted'),
      done: list.filter((c) => c.status === 'approved' || c.status === 'paid'),
    };
  }, [claimsQ.data]);

  const loading = dcrsQ.isPending || claimsQ.isPending;

  async function openNew() {
    setCreating(true);
    try {
      const month = todayIST().slice(0, 7);
      const claim = await ensureClaim(month);
      void claimsQ.refetch();
      router.push({ pathname: '/expenses/[id]', params: { id: claim.id } });
    } catch (e) {
      Alert.alert('Could not start claim', expenseMessage(e));
    } finally {
      setCreating(false);
    }
  }

  function openClaim(c: { id: string }, date?: string) {
    router.push({
      pathname: '/expenses/[id]',
      params: date ? { id: c.id, date } : { id: c.id },
    });
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Expenses' }} />
      <PullToRefresh onRefresh={() => Promise.all([dcrsQ.refetch(), syncQ.refetch()])}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: scrollPad }]}
        >
          <AppText variant="bodyMuted" style={styles.intro}>
            TA/DA fills in from your DCRs and SFC. Add courier, mobile, team meeting and extra
            TA/DA on each day when you open a claim.
          </AppText>

          <Section title="From your DCRs" count={cards.length}>
            {loading || syncQ.isPending ? (
              <SkeletonList count={2} />
            ) : !cards.length ? (
              <Card style={styles.pad}>
                <AppText variant="body">No open day drafts</AppText>
                <AppText variant="bodyMuted">
                  Submit a DCR and that day’s TA/DA appears here. Or tap New Expense for this month.
                </AppText>
              </Card>
            ) : (
              <Card>
                {cards.map((c, i) => (
                  <ListRow
                    key={c.date}
                    icon="receipt"
                    tone="blue"
                    title={dateLabel(c.date)}
                    subtitle={`TA/DA ${formatINR(c.tada)}${c.extras > 0 ? ` + extras ${formatINR(c.extras)}` : ''}${c.count ? ` · ${c.count} lines` : ''}`}
                    trailing={<Chip label="Draft day" tone="blue" />}
                    divider={i > 0}
                    onPress={() => c.claim && openClaim(c.claim, c.date)}
                  />
                ))}
              </Card>
            )}
            {syncQ.isError ? (
              <AppText variant="caption" style={styles.err}>
                {expenseMessage(syncQ.error)}
              </AppText>
            ) : null}
          </Section>

          <Section title="Open claims" count={groups.draft.length}>
            {claimsQ.isPending ? (
              <SkeletonList count={2} />
            ) : claimsQ.isError ? (
              <Card style={styles.pad}>
                <AppText variant="bodyMuted">{expenseMessage(claimsQ.error)}</AppText>
              </Card>
            ) : !groups.draft.length ? (
              <Card style={styles.pad}>
                <AppText variant="bodyMuted">No draft or sent-back claims.</AppText>
              </Card>
            ) : (
              <Card>
                {groups.draft.map((c, i) => (
                  <ClaimRow
                    key={c.id}
                    c={c}
                    flagged={flagged(c)}
                    divider={i > 0}
                    onPress={() => openClaim(c)}
                  />
                ))}
              </Card>
            )}
          </Section>

          <Section title="Waiting for approval" count={groups.pending.length}>
            {!groups.pending.length ? null : (
              <Card>
                {groups.pending.map((c, i) => (
                  <ClaimRow
                    key={c.id}
                    c={c}
                    flagged={false}
                    divider={i > 0}
                    onPress={() => openClaim(c)}
                  />
                ))}
              </Card>
            )}
          </Section>

          <Section title="Approved / paid" count={groups.done.length}>
            {!groups.done.length ? null : (
              <Card>
                {groups.done.map((c, i) => (
                  <ClaimRow
                    key={c.id}
                    c={c}
                    flagged={false}
                    divider={i > 0}
                    onPress={() => openClaim(c)}
                  />
                ))}
              </Card>
            )}
          </Section>
        </ScrollView>
      </PullToRefresh>

      <FloatingFab
        label={creating ? 'Opening…' : 'New Expense'}
        accessibilityLabel="New expense claim"
        tone="canopy"
        onPress={() => {
          if (!creating) void openNew();
        }}
      />
    </View>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <AppText variant="headline">{title}</AppText>
        <AppText variant="small">
          {count} {count === 1 ? 'item' : 'items'}
        </AppText>
      </View>
      {children}
    </View>
  );
}

function ClaimRow({
  c,
  flagged,
  divider,
  onPress,
}: {
  c: ClaimSummary;
  flagged: boolean;
  divider: boolean;
  onPress: () => void;
}) {
  return (
    <ListRow
      icon="receipt"
      tone={STATUS_TONE[c.status] === 'red' ? 'red' : 'teal'}
      title={monthLabel(c.month)}
      subtitle={`${formatINR(c.total)} · ${c.lineCount} ${c.lineCount === 1 ? 'line' : 'lines'}${
        c.rejectionReason && c.status === 'rejected' ? ` · ${c.rejectionReason}` : ''
      }`}
      trailing={
        <View style={styles.chips}>
          {flagged && !isEditable(c.status) ? <Chip label="DCR rejected" tone="red" /> : null}
          <Chip label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />
        </View>
      }
      divider={divider}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.lg },
  intro: { marginBottom: spacing.xs },
  section: { gap: spacing.sm },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  pad: { padding: spacing.lg, gap: spacing.sm },
  chips: { alignItems: 'flex-end', gap: spacing.xs },
  err: { color: colors.danger, fontFamily: fonts.medium },
});
