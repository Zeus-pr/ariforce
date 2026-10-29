import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { DecisionBar } from '@/components/approvals/decision-bar';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { ScrollView } from '@/components/scroll';
import { SkeletonDetail } from '@/components/skeleton';
import { useAuth } from '@/lib/auth-context';
import { useTeamNames } from '@/lib/dcr/adapter';
import { useDcrOptions, useDcrTerritories } from '@/lib/dcr/api';
import { dateLabel, savedLabel, todayIST } from '@/lib/dcr/dates';
import { BAND_LABEL, normaliseWorkTypes, territoryRows } from '@/lib/dcr/model';
import { bandOf } from '@/lib/dcr/bands';
import { isApprover } from '@/lib/roles';
import { TP_LABEL, TP_TONE, datesOf, rangeLabel, useDecideTp, useTp } from '@/lib/tp/adapter';
import { layout, spacing } from '@/theme';

/** One team tour plan, read-only, with approve / reject. */
export default function ReviewTpScreen() {
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!isApprover(user?.roles ?? [])) return <Redirect href="/" />;
  return <Review id={id} />;
}

function Review({ id }: { id: string }) {
  const router = useRouter();
  const bottom = useBottomSpace();
  const q = useTp(id);
  const t = q.data;
  const optionsQ = useDcrOptions(todayIST());
  const terrQ = useDcrTerritories(!!t);
  const namesQ = useTeamNames(!!t);
  const decide = useDecideTp();
  const [error, setError] = useState<string | null>(null);

  const placeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of territoryRows(terrQ.data ?? [])) m.set(r.id, r.name);
    return m;
  }, [terrQ.data]);

  if (q.isPending)
    return (
      <View style={[styles.flex, styles.content]}>
        <Stack.Screen options={{ title: 'Review tour plan' }} />
        <SkeletonDetail fields={5} />
      </View>
    );
  if (!t)
    return (
      <View style={[styles.flex, styles.content]}>
        <Stack.Screen options={{ title: 'Review tour plan' }} />
        <AppText variant="bodyMuted">{(q.error as Error | null)?.message ?? 'Not found.'}</AppText>
      </View>
    );

  const wt = normaliseWorkTypes(optionsQ.data?.workTypes ?? []).find(
    (w) => w.id === t.plan.workTypeId,
  );
  const band = wt?.band ? BAND_LABEL[bandOf(wt.band)!] : null;
  const days = datesOf(t.from, t.to).length;
  const det = t.plan.details;
  const who = t.userName || namesQ.data?.get(t.userId) || 'Team member';
  const what = `${who}'s tour plan for ${rangeLabel(t.from, t.to)}`;
  const people = t.plan.workWithUserIds.map((u) => namesQ.data?.get(u) ?? 'Colleague');

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Review tour plan' }} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
      >
        <Card style={styles.pad}>
          <View style={styles.row}>
            <AppText variant="section" style={styles.flex}>
              {who}
            </AppText>
            <Chip label={TP_LABEL[t.status]} tone={TP_TONE[t.status]} />
          </View>
          <AppText variant="body">
            {t.from === t.to
              ? dateLabel(t.from)
              : `${dateLabel(t.from)} to ${dateLabel(t.to)} (${days} days)`}
          </AppText>
          {t.submittedAt ? (
            <AppText variant="small">Sent {savedLabel(t.submittedAt)}</AppText>
          ) : null}
          {t.status === 'rejected' && t.rejectionReason ? (
            <AppText variant="small">Rejected: {t.rejectionReason}</AppText>
          ) : null}
        </Card>

        <Card style={styles.pad}>
          <AppText variant="label">Work on</AppText>
          <AppText variant="body">
            {[wt?.name ?? 'Work type', band].filter(Boolean).join(' · ')}
          </AppText>
          {t.plan.territoryIds.length ? (
            <>
              <AppText variant="label">Territories</AppText>
              <AppText variant="body">
                {t.plan.territoryIds.map((x) => placeName.get(x) ?? 'Territory').join(', ')}
              </AppText>
            </>
          ) : null}
          {wt?.band ? (
            <>
              <AppText variant="label">Work with</AppText>
              <AppText variant="body">{people.length ? people.join(', ') : 'Alone'}</AppText>
            </>
          ) : null}
          {t.plan.sfcRoutes.length ? (
            <AppText variant="small">
              {t.plan.sfcRoutes.length} SFC route{t.plan.sfcRoutes.length === 1 ? '' : 's'} chosen
            </AppText>
          ) : null}
          {det && 'title' in det ? <AppText variant="body">{det.title}</AppText> : null}
          {det && 'description' in det ? <AppText variant="body">{det.description}</AppText> : null}
        </Card>

        {t.status === 'pending' ? (
          <Card style={styles.pad}>
            <DecisionBar
              what={what}
              busy={decide.isPending}
              error={error}
              onDecide={(decision, reason) => {
                setError(null);
                decide.mutate(
                  { id: t.id, decision, reason },
                  {
                    onSuccess: () => {
                      Alert.alert(decision === 'approve' ? 'Approved' : 'Rejected', `${what}.`);
                      router.back();
                    },
                    onError: (e) => setError(e.message),
                  },
                );
              }}
            />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  pad: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
