import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { DecisionBar } from '@/components/approvals/decision-bar';
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
import { isApprover } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

/** Manager review (ABM and above, same rule as the website's isApprover): DCRs and unlock requests. */
export default function ApprovalsScreen() {
  const { user } = useAuth();
  if (!isApprover(user?.roles ?? [])) return <Redirect href="/" />;
  return <Approvals myId={user?.id} />;
}

function Approvals({ myId }: { myId?: string }) {
  const router = useRouter();
  const bottom = useBottomSpace();
  const teamQ = useTeamSubmitted(myId);
  const decisionsQ = useDecisions();
  const namesQ = useTeamNames(true);
  const unlockQ = useUnlockQueue(true);
  const decide = useDecideApproval();
  const [deciding, setDeciding] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const toReview = useMemo(
    () => (teamQ.data ?? []).filter((d) => reviewOf(d, decisionsQ.data).status === 'submitted'),
    [teamQ.data, decisionsQ.data],
  );
  const name = (id: string) => namesQ.data?.get(id) ?? 'Team member';

  const refreshing = (teamQ.isRefetching || unlockQ.isRefetching) && !teamQ.isPending;
  const refresh = () => {
    void teamQ.refetch();
    void unlockQ.refetch();
    void decisionsQ.refetch();
  };

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Approvals' }} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.navy}
            colors={[colors.navy]}
          />
        }
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

        <AppText variant="small" style={styles.section}>
          {unlockQ.isPending ? 'Unlock requests' : `Unlock requests (${unlockQ.data?.length ?? 0})`}
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
      </ScrollView>
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
