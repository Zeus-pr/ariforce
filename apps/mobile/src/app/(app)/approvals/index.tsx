import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ApprovalInboxCard } from '@/components/approvals/inbox-card';
import { PullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Icon } from '@/components/icon';
import { ScrollView } from '@/components/scroll';
import { SkeletonList } from '@/components/skeleton';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { useAuth } from '@/lib/auth-context';
import {
  apiCaps,
  decisionErrorMessage,
  reviewOf,
  useDecideApproval,
  useDecideDcr,
  useDecisions,
  useTeamNames,
  useTeamSubmitted,
  useUnlockQueue,
} from '@/lib/dcr/adapter';
import { dateLabel, savedLabel } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { isApprover, isDirector } from '@/lib/roles';
import {
  claimDcrRejected,
  expenseMessage,
  monthLabel,
  useClaimQueue,
  useDecideExpenseClaim,
} from '@/lib/expenses';
import { formatINR } from '@/lib/money';
import {
  daysLabel,
  leaveMessage,
  rangeLabel as leaveRange,
  useDecideLeave,
  useLeaveQueue,
} from '@/lib/leave';
import {
  CONTRACT as TP_CONTRACT,
  rangeLabel,
  tpMessage,
  useDecideTp,
  useTpQueue,
} from '@/lib/tp/adapter';
import { colors, layout, spacing } from '@/theme';

/** Manager review (ABM and above, same rule as the website's isApprover): DCRs and unlock requests. */
export default function ApprovalsScreen() {
  const { user } = useAuth();
  if (!isApprover(user?.roles ?? [])) return <Redirect href="/" />;
  return <Approvals myId={user?.id} director={isDirector(user?.roles ?? [])} />;
}

function Queue({
  title,
  detail,
  open,
  onPress,
  children,
}: {
  title: string;
  detail: string;
  open: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.queue}>
      <Card>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.queueHead}
        >
          <View style={styles.queueCopy}>
            <AppText variant="label">{title}</AppText>
            <AppText variant="small">{detail}</AppText>
          </View>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.subtle} />
        </Pressable>
      </Card>
      {open ? children : null}
    </View>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <Card style={styles.pad}>
      <AppText variant="bodyMuted">{message}</AppText>
    </Card>
  );
}

function Approvals({ myId, director }: { myId?: string; director: boolean }) {
  const router = useRouter();
  const bottom = useBottomSpace();
  const teamQ = useTeamSubmitted(myId);
  const decisionsQ = useDecisions();
  const namesQ = useTeamNames(true);
  const unlockQ = useUnlockQueue(director);
  const leaveQ = useLeaveQueue(myId, true);
  const expQ = useClaimQueue(myId, true);
  const tpQ = useTpQueue(myId, true);
  const decideLeave = useDecideLeave();
  const decideDcr = useDecideDcr();
  const decideTp = useDecideTp();
  const decideExpense = useDecideExpenseClaim();
  const decideUnlock = useDecideApproval();
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

  const decideKey = (kind: string, id: string) => `${kind}:${id}`;
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));
  const waiting = (pending: boolean, n: number) =>
    pending ? 'Loading…' : n === 0 ? 'Nothing waiting' : `${n} waiting`;

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Approvals' }} />
      <PullToRefresh onRefresh={refresh}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        >
          <Queue
            title="DCRs"
            detail={
              !apiCaps.decisionRoute
                ? 'Sample decisions'
                : waiting(teamQ.isPending, toReview.length)
            }
            open={open === 'dcr'}
            onPress={() => toggle('dcr')}
          >
            {teamQ.isPending ? (
              <SkeletonList count={3} />
            ) : teamQ.isError ? (
              <EmptyCard message={saveMessage(teamQ.error)} />
            ) : !toReview.length ? (
              <EmptyCard message="Nothing to review. Submitted DCRs from your team show here." />
            ) : (
              toReview.map((d, i) => {
                const rep = name(d.userId);
                const n = d.callCount ?? d.calls?.length ?? 0;
                const submitted = d.submittedAt ? ` · Submitted ${savedLabel(d.submittedAt)}` : '';
                const what = `${rep}'s DCR for ${dateLabel(d.date)}`;
                const key = decideKey('dcr', d.id);
                return (
                  <ApprovalInboxCard
                    key={d.id}
                    index={i}
                    icon="clipboard-text-outline"
                    tone="teal"
                    who={rep}
                    typeLabel="DCR"
                    typeTone="teal"
                    summary={`${dateLabel(d.date)} · ${n} call${n === 1 ? '' : 's'}${submitted}`}
                    what={what}
                    busy={deciding === key}
                    error={errors[key]}
                    onDetails={() =>
                      router.push({
                        pathname: '/approvals/dcr/[id]',
                        params: { id: d.id, name: rep },
                      })
                    }
                    onDecide={(decision, reason) => {
                      setDeciding(key);
                      setErrors((x) => {
                        const next = { ...x };
                        delete next[key];
                        return next;
                      });
                      decideDcr.mutate(
                        { id: d.id, decision, reason },
                        {
                          onSettled: () => setDeciding(null),
                          onError: (e) =>
                            setErrors((x) => ({ ...x, [key]: decisionErrorMessage(e) })),
                        },
                      );
                    }}
                  />
                );
              })
            )}
          </Queue>

          <Queue
            title="Tour plans"
            detail={
              !TP_CONTRACT.tpItems ? 'Sample mode' : waiting(tpQ.isPending, tpQ.data?.length ?? 0)
            }
            open={open === 'tp'}
            onPress={() => toggle('tp')}
          >
            {tpQ.isPending ? (
              <SkeletonList count={2} />
            ) : tpQ.isError ? (
              <EmptyCard message={saveMessage(tpQ.error)} />
            ) : !tpQ.data?.length ? (
              <EmptyCard message="No tour plans waiting for you." />
            ) : (
              tpQ.data.map((t, i) => {
                const who = t.userName || name(t.userId);
                const what = `${who}'s tour plan for ${rangeLabel(t.from, t.to)}`;
                const key = decideKey('tp', t.id);
                return (
                  <ApprovalInboxCard
                    key={t.id}
                    index={i}
                    icon="calendar-month-outline"
                    tone="blue"
                    who={who}
                    typeLabel="Tour plan"
                    typeTone="blue"
                    summary={
                      t.submittedAt
                        ? `${rangeLabel(t.from, t.to)} · Sent ${savedLabel(t.submittedAt)}`
                        : `${rangeLabel(t.from, t.to)} · Sent for approval`
                    }
                    what={what}
                    busy={deciding === key}
                    error={errors[key]}
                    onDetails={() =>
                      router.push({ pathname: '/approvals/tp/[id]', params: { id: t.id } })
                    }
                    onDecide={(decision, reason) => {
                      setDeciding(key);
                      setErrors((x) => {
                        const next = { ...x };
                        delete next[key];
                        return next;
                      });
                      decideTp.mutate(
                        { id: t.id, decision, reason },
                        {
                          onSettled: () => setDeciding(null),
                          onError: (e) => setErrors((x) => ({ ...x, [key]: tpMessage(e) })),
                        },
                      );
                    }}
                  />
                );
              })
            )}
          </Queue>

          <Queue
            title="Leave"
            detail={waiting(leaveQ.isPending, leaveQ.data?.length ?? 0)}
            open={open === 'leave'}
            onPress={() => toggle('leave')}
          >
            {leaveQ.isPending ? (
              <SkeletonList count={2} />
            ) : leaveQ.isError ? (
              <EmptyCard message={leaveMessage(leaveQ.error)} />
            ) : !leaveQ.data?.length ? (
              <EmptyCard message="No leave requests waiting for you." />
            ) : (
              leaveQ.data.map((l, i) => {
                const what = `${l.userName}'s ${l.typeName} (${leaveRange(l)})`;
                const key = decideKey('leave', l.id);
                return (
                  <ApprovalInboxCard
                    key={l.id}
                    index={i}
                    icon="calendar-clock-outline"
                    tone="green"
                    who={l.userName}
                    typeLabel="Leave"
                    typeTone="green"
                    summary={`${l.typeName} · ${leaveRange(l)} · ${daysLabel(l.days)}`}
                    expandOnDetails={
                      <AppText variant="bodyMuted">
                        {l.reason ? `Reason: ${l.reason}` : 'No reason provided.'}
                      </AppText>
                    }
                    what={what}
                    busy={deciding === key}
                    error={errors[key]}
                    onDecide={(decision, reason) => {
                      setDeciding(key);
                      setErrors((x) => {
                        const next = { ...x };
                        delete next[key];
                        return next;
                      });
                      decideLeave.mutate(
                        { id: l.id, decision, comment: reason ?? undefined },
                        {
                          onSettled: () => setDeciding(null),
                          onError: (e) => setErrors((x) => ({ ...x, [key]: leaveMessage(e) })),
                        },
                      );
                    }}
                  />
                );
              })
            )}
          </Queue>

          <Queue
            title="Expenses"
            detail={waiting(expQ.isPending, expQ.data?.length ?? 0)}
            open={open === 'exp'}
            onPress={() => toggle('exp')}
          >
            {expQ.isPending ? (
              <SkeletonList count={2} />
            ) : !expQ.data?.length ? (
              <EmptyCard
                message={
                  expQ.isError
                    ? 'Could not load expense claims.'
                    : 'No expense claims waiting for you.'
                }
              />
            ) : (
              expQ.data.map((c, i) => {
                const dcrBlocked = claimDcrRejected(c, () => false);
                const what = `${c.userName}'s expense claim for ${monthLabel(c.month)}`;
                const key = decideKey('exp', c.id);
                return (
                  <ApprovalInboxCard
                    key={c.id}
                    index={i}
                    icon="receipt"
                    tone="orange"
                    who={c.userName}
                    typeLabel="Expense"
                    typeTone="orange"
                    summary={`${monthLabel(c.month)} · ${formatINR(c.total)} · Level ${c.approvalStep ?? 1} of ${c.totalLevels ?? 1}`}
                    meta={dcrBlocked ? <Chip label="DCR rejected" tone="red" /> : undefined}
                    what={what}
                    busy={deciding === key}
                    error={errors[key]}
                    approveBlocked={
                      dcrBlocked ? 'Fix rejected DCR days on the claim before approving.' : null
                    }
                    onDetails={() =>
                      router.push({ pathname: '/expenses/[id]', params: { id: c.id } })
                    }
                    onDecide={(decision, reason) => {
                      setDeciding(key);
                      setErrors((x) => {
                        const next = { ...x };
                        delete next[key];
                        return next;
                      });
                      decideExpense.mutate(
                        { id: c.id, decision, comment: reason ?? undefined },
                        {
                          onSettled: () => setDeciding(null),
                          onError: (e) => setErrors((x) => ({ ...x, [key]: expenseMessage(e) })),
                        },
                      );
                    }}
                  />
                );
              })
            )}
          </Queue>

          {director ? (
            <Queue
              title="Unlock requests"
              detail={waiting(unlockQ.isPending, unlockQ.data?.length ?? 0)}
              open={open === 'unlock'}
              onPress={() => toggle('unlock')}
            >
              {unlockQ.isPending ? (
                <SkeletonList count={2} />
              ) : unlockQ.isError ? (
                <EmptyCard message={saveMessage(unlockQ.error)} />
              ) : !unlockQ.data?.length ? (
                <EmptyCard message="No pending unlock requests." />
              ) : (
                unlockQ.data.map((a, i) => {
                  const what = `${a.requestedByName}'s unlock request`;
                  const key = decideKey('unlock', a.id);
                  return (
                    <ApprovalInboxCard
                      key={a.id}
                      index={i}
                      icon="lock-open-variant-outline"
                      tone="navy"
                      who={a.requestedByName}
                      typeLabel="Unlock"
                      typeTone="navy"
                      summary={a.summary}
                      meta={
                        <>
                          {a.comment ? (
                            <AppText variant="caption" numberOfLines={2}>
                              {a.comment}
                            </AppText>
                          ) : null}
                          <AppText variant="caption">Requested {savedLabel(a.createdAt)}</AppText>
                        </>
                      }
                      what={what}
                      busy={deciding === key}
                      error={errors[key]}
                      detailsLabel="View DCR"
                      onDetails={() =>
                        router.push({
                          pathname: '/approvals/dcr/[id]',
                          params: { id: a.subjectId, name: a.requestedByName },
                        })
                      }
                      onDecide={(decision, reason) => {
                        setDeciding(key);
                        setErrors((x) => {
                          const next = { ...x };
                          delete next[key];
                          return next;
                        });
                        decideUnlock.mutate(
                          { id: a.id, decision, comment: reason ?? undefined },
                          {
                            onSettled: () => setDeciding(null),
                            onError: (e) => setErrors((x) => ({ ...x, [key]: saveMessage(e) })),
                          },
                        );
                      }}
                    />
                  );
                })
              )}
            </Queue>
          ) : null}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.lg, gap: spacing.md },
  queue: { gap: spacing.md },
  queueHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  queueCopy: { flex: 1, gap: 2 },
  pad: { padding: spacing.lg, gap: spacing.sm },
});
