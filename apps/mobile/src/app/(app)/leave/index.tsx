import { Stack, useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { RefreshBar, pullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { ScrollView } from '@/components/scroll';
import { SkeletonCard, SkeletonList } from '@/components/skeleton';
import {
  STATUS_LABEL,
  STATUS_TONE,
  cancellable,
  daysLabel,
  leaveMessage,
  rangeLabel,
  useCancelLeave,
  useLeaveData,
} from '@/lib/leave';
import { layout, spacing } from '@/theme';

/** My leave (web leave-view/my-leave): balances, requests with status, cancel, Apply. */
export default function LeaveScreen() {
  const router = useRouter();
  const bottom = useBottomSpace();
  const q = useLeaveData();
  const cancel = useCancelLeave();

  const confirmCancel = (id: string, label: string) =>
    Alert.alert('Cancel this leave?', `${label}. Any balance it holds is given back.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel leave',
        style: 'destructive',
        onPress: () =>
          cancel.mutate(
            { id, reason: null },
            { onError: (e) => Alert.alert('Could not cancel', leaveMessage(e)) },
          ),
      },
    ]);

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: 'Leave' }} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        refreshControl={pullToRefresh(q.isRefetching && !q.isPending, () => void q.refetch())}
      >
        <RefreshBar active={q.isRefetching && !q.isPending} />
        <Button label="Apply for leave" onPress={() => router.push('/leave/apply')} />
        <AppText variant="small">Balance this year</AppText>
        {q.isPending ? (
          <SkeletonCard lines={3} />
        ) : q.isError ? (
          <Card style={styles.pad}>
            <AppText variant="bodyMuted">{leaveMessage(q.error)}</AppText>
          </Card>
        ) : (
          <View style={styles.grid}>
            {q.data.balances.map((b) => (
              <Card key={b.typeCode} style={[styles.pad, styles.cell]}>
                <AppText variant="count">{b.unlimited ? '∞' : (b.available ?? 0)}</AppText>
                <AppText variant="label" numberOfLines={1}>
                  {b.typeName}
                </AppText>
                <AppText variant="small">
                  {b.used} used{b.pending ? ` · ${b.pending} pending` : ''}
                </AppText>
              </Card>
            ))}
          </View>
        )}
        <AppText variant="small" style={styles.section}>
          My requests
        </AppText>
        {q.isPending ? (
          <SkeletonList count={3} />
        ) : !q.data?.requests.length ? (
          <Card style={styles.pad}>
            <AppText variant="bodyMuted">No leave requests this year.</AppText>
          </Card>
        ) : (
          q.data.requests.map((r) => (
            <Card key={r.id} style={styles.pad}>
              <View style={styles.row}>
                <AppText variant="label" style={styles.flex}>
                  {r.typeName} · {daysLabel(r.days)}
                </AppText>
                <Chip label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
              </View>
              <AppText variant="body">{rangeLabel(r)}</AppText>
              {r.reason ? <AppText variant="bodyMuted">{r.reason}</AppText> : null}
              {r.status === 'rejected' && r.rejectionReason ? (
                <AppText variant="small">Rejected: {r.rejectionReason}</AppText>
              ) : null}
              {cancellable(r) ? (
                <Button
                  label="Cancel leave"
                  variant="secondary"
                  compact
                  loading={cancel.isPending && cancel.variables?.id === r.id}
                  loadingLabel="Cancelling…"
                  onPress={() => confirmCancel(r.id, `${r.typeName}, ${rangeLabel(r)}`)}
                />
              ) : null}
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
  pad: { padding: spacing.lg, gap: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  cell: { flexBasis: '47%', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  section: { marginTop: spacing.sm },
});
