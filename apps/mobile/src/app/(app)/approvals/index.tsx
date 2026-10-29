import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { DecisionBar } from '@/components/approvals/decision-bar';
import { PullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { ListRow } from '@/components/list-row';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { useAuth } from '@/lib/auth-context';
import {
  apiCaps,
  reviewOf,
  useDecideApproval,
  useDecisions,
  useTeamNames,
  useTeamSubmitted,
  useUnlockQueue,
} from '@/lib/dcr/adapter';
import { dateLabel, savedLabel } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { isApprover, isDirector } from '@/lib/roles';
import { monthLabel, useClaimQueue } from '@/lib/expenses';
import { formatINR } from '@/lib/money';
import {
  daysLabel,
  leaveMessage,
  rangeLabel as leaveRange,
  useDecideLeave,
  useLeaveQueue,
} from '@/lib/leave';
import { CONTRACT as TP_CONTRACT, rangeLabel, useTpQueue } from '@/lib/tp/adapter';
import { layout, spacing } from '@/theme';

/** Manager review (ABM and above, same rule as the website's isApprover): DCRs and unlock requests. */
export default function ApprovalsScreen() {
  const { user } = useAuth();
  if (!isApprover(user?.roles ?? [])) return <Redirect href="/" />;
  return <Approvals myId={user?.id} director={isDirector(user?.roles ?? [])} />;
}

function Approvals({ myId, director }: { myId?: string; director: boolean }) {
  const router = useRouter();
  const bottom = useBottomSpace();
  const teamQ = useTeamSubmitted(myId);
  const decisionsQ = useDecisions();
  const namesQ = useTeamNames(true);
  // Only a Director decides DCR unlock requests (server-enforced); DCR and TP stay ABM and up.
  const unlockQ = useUnlockQueue(director);
  const leaveQ = useLeaveQueue(myId, true);
  const decideLeave = useDecideLeave();
  const expQ = useClaimQueue(myId, true);
  const tpQ = useTpQueue(myId, true);
  const decide = useDecideApproval();
  const [deciding, setDeciding] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toReview = useMemo(
    () => (teamQ.data ?? []).filter((d) => reviewOf(d, decisionsQ.data).status === 'submitted'),
    [teamQ.data, decisionsQ.data],
  );
  const name = (id: string) => namesQ.data?.get(id) ?? 'Team member';

  const refresh = () =>
    Promise.all([
      teamQ.refetch(),
      decisionsQ.refetch(),
      tpQ.refetch(),
      leaveQ.refetch(),
      expQ.refetch(),
      director ? unlockQ.refetch() : null,
    ]);

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Approvals' }} />
      <PullToRefresh onRefresh={refresh}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        >
          <View style={styles.head}>
            <AppText variant="small">
              {teamQ.isPending ? 'DCRs to review' : `DCRs to review (${toReview.length})`}
            </AppText>
            {!apiCaps.decisionRoute ? <Chip label="Decisions: sample mode" tone="orange" /> : null}
          </View>
          {teamQ.isPending ? (
            <SkeletonList count={3} />
          ) : teamQ.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">{saveMessage(teamQ.error)}</AppText>
            </Card>
          ) : !toReview.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">
                Nothing to review. Submitted DCRs from your team show here.
              </AppText>
            </Card>
          ) : (
            <Card>
              {toReview.map((d, i) => {
                const n = d.callCount ?? d.calls?.length ?? 0;
                return (
                  <ListRow
                    key={d.id}
                    icon="clipboard-text-outline"
                    tone="teal"
                    title={`${name(d.userId)} · ${dateLabel(d.date)}`}
                    subtitle={`${n} call${n === 1 ? '' : 's'}${d.submittedAt ? ` · Submitted ${savedLabel(d.submittedAt)}` : ''}`}
                    onPress={() =>
                      router.push({
                        pathname: '/approvals/dcr/[id]',
                        params: { id: d.id, name: name(d.userId) },
                      })
                    }
                    divider={i < toReview.length - 1}
                  />
                );
              })}
            </Card>
          )}

          <View style={[styles.head, styles.section]}>
            <AppText variant="small">
              {tpQ.isPending ? 'Tour plans' : `Tour plans (${tpQ.data?.length ?? 0})`}
            </AppText>
            {!TP_CONTRACT.tpItems ? <Chip label="Sample mode" tone="orange" /> : null}
          </View>
          {tpQ.isPending ? (
            <SkeletonList count={2} />
          ) : tpQ.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">{saveMessage(tpQ.error)}</AppText>
            </Card>
          ) : !tpQ.data?.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">No tour plans waiting for you.</AppText>
            </Card>
          ) : (
            <Card>
              {tpQ.data.map((t, i) => (
                <ListRow
                  key={t.id}
                  icon="calendar-month-outline"
                  tone="blue"
                  title={`${t.userName || name(t.userId)} · TP ${rangeLabel(t.from, t.to)}`}
                  subtitle={
                    t.submittedAt ? `Sent ${savedLabel(t.submittedAt)}` : 'Sent for approval'
                  }
                  onPress={() =>
                    router.push({ pathname: '/approvals/tp/[id]', params: { id: t.id } })
                  }
                  divider={i < tpQ.data.length - 1}
                />
              ))}
            </Card>
          )}

          <AppText variant="small" style={styles.section}>
            {leaveQ.isPending ? 'Leave' : `Leave (${leaveQ.data?.length ?? 0})`}
          </AppText>
          {leaveQ.isPending ? (
            <SkeletonList count={2} />
          ) : leaveQ.isError ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">{leaveMessage(leaveQ.error)}</AppText>
            </Card>
          ) : !leaveQ.data?.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">No leave requests waiting for you.</AppText>
            </Card>
          ) : (
            leaveQ.data.map((l) => (
              <Card key={l.id} style={styles.pad}>
                <AppText variant="label">{l.userName}</AppText>
                <AppText variant="body">
                  {l.typeName} · {leaveRange(l)} · {daysLabel(l.days)}
                </AppText>
                {l.reason ? <AppText variant="bodyMuted">Reason: {l.reason}</AppText> : null}
                <DecisionBar
                  what={`${l.userName}'s ${l.typeName} (${leaveRange(l)})`}
                  busy={deciding === l.id}
                  error={errors[l.id]}
                  onDecide={(decision, reason) => {
                    setDeciding(l.id);
                    decideLeave.mutate(
                      { id: l.id, decision, comment: reason ?? undefined },
                      {
                        onSettled: () => setDeciding(null),
                        // LEAVE_DCR_CONFLICT: a submitted DCR on a leave date blocks approval.
                        onError: (e) => setErrors((x) => ({ ...x, [l.id]: leaveMessage(e) })),
                      },
                    );
                  }}
                />
              </Card>
            ))
          )}

          <AppText variant="small" style={styles.section}>
            {expQ.isPending ? 'Expenses' : `Expenses (${expQ.data?.length ?? 0})`}
          </AppText>
          {expQ.isPending ? (
            <SkeletonList count={2} />
          ) : !expQ.data?.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">
                {expQ.isError
                  ? 'Could not load expense claims.'
                  : 'No expense claims waiting for you.'}
              </AppText>
            </Card>
          ) : (
            <Card>
              {expQ.data.map((c, i) => (
                <ListRow
                  key={c.id}
                  icon="receipt"
                  tone="orange"
                  title={c.userName}
                  subtitle={`${monthLabel(c.month)} · ${formatINR(c.total)}`}
                  divider={i > 0}
                  onPress={() => router.push({ pathname: '/expenses/[id]', params: { id: c.id } })}
                />
              ))}
            </Card>
          )}

          {director ? (
            <>
              <AppText variant="small" style={styles.section}>
                {unlockQ.isPending
                  ? 'Unlock requests'
                  : `Unlock requests (${unlockQ.data?.length ?? 0})`}
              </AppText>
              {unlockQ.isPending ? (
                <SkeletonList count={2} />
              ) : unlockQ.isError ? (
                <Card style={styles.pad}>
                  <AppText variant="bodyMuted">{saveMessage(unlockQ.error)}</AppText>
                </Card>
              ) : !unlockQ.data?.length ? (
                <Card style={styles.pad}>
                  <AppText variant="bodyMuted">No pending unlock requests.</AppText>
                </Card>
              ) : (
                unlockQ.data.map((a) => (
                  <Card key={a.id} style={styles.pad}>
                    <AppText variant="label">{a.requestedByName}</AppText>
                    <AppText variant="body">{a.summary}</AppText>
                    {a.comment ? <AppText variant="bodyMuted">Reason: {a.comment}</AppText> : null}
                    <AppText variant="small">Requested {savedLabel(a.createdAt)}</AppText>
                    <DecisionBar
                      what={`${a.requestedByName}'s unlock request`}
                      busy={deciding === a.id}
                      error={errors[a.id]}
                      onDecide={(decision, reason) => {
                        setDeciding(a.id);
                        decide.mutate(
                          { id: a.id, decision, comment: reason ?? undefined },
                          {
                            onSettled: () => setDeciding(null),
                            onError: (e) => setErrors((x) => ({ ...x, [a.id]: saveMessage(e) })),
                          },
                        );
                      }}
                    />
                  </Card>
                ))
              )}
            </>
          ) : null}
        </ScrollView>
      </PullToRefresh>
    </View>
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
  section: { marginTop: spacing.sm },
  pad: { padding: spacing.lg, gap: spacing.sm },
});
