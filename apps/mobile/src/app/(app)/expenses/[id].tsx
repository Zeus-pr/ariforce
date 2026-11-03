/**
 * One month's claim (mirrors web PR #94 claim-view): status + total, approval trail stepper,
 * "Auto-filled from your DCR" card (Confirm / Edit / Recalculate), day cards, and one sticky
 * bottom action driven by canDecide / canPay.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { ApprovalTrail } from '@/components/expenses/approval-trail';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { PullToRefresh } from '@/components/refresh';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { SkeletonCard } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/lib/auth-context';
import { dateLabel } from '@/lib/dcr/dates';
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type Line,
  expenseMessage,
  isEditable,
  monthLabel,
  receiptUrl,
  runAllowances,
  useClaim,
  useLineMutations,
  useRecon,
} from '@/lib/expenses';
import { formatINR } from '@/lib/money';
import { colors, fonts, layout, radius, spacing } from '@/theme';

export default function ClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const q = useClaim(id);
  const m = useLineMutations(id);
  const claim = q.data;
  const mine = !!claim && claim.userId === user?.id;
  const editable = mine && !!claim && isEditable(claim.status);
  const canDecide = !!claim?.canDecide;
  const canPay = !!claim?.canPay;
  const recon = useRecon(id, canDecide);

  const [mode, setMode] = useState<null | 'reject' | 'pay'>(null);
  const [reason, setReason] = useState('');
  const [payRef, setPayRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const days = useMemo(() => {
    const map = new Map<string, Line[]>();
    for (const l of claim?.lines ?? []) map.set(l.date, [...(map.get(l.date) ?? []), l]);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [claim]);
  const auto = (claim?.lines ?? []).filter((l) => l.source === 'auto');
  const autoTotal = auto.reduce((s, l) => s + l.amount, 0);

  // Approve is blocked when a claimed day lacks an approved DCR (server also returns DCR_NOT_APPROVED).
  const blockedDays = useMemo(() => {
    const out = new Set(claim?.dcrRejectedDates ?? []);
    for (const d of recon.data?.days ?? [])
      if (d.claimed > 0 && d.dcrStatus !== 'approved') out.add(d.date);
    return [...out].sort();
  }, [claim, recon.data]);
  const approveBlock = blockedDays.length
    ? `DCR not approved for ${blockedDays.map((d) => dateLabel(d)).join(', ')}`
    : null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setMode(null);
      m.refresh();
    } catch (e) {
      setError(expenseMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const openReceipt = async (attId: string) => {
    try {
      const url = await receiptUrl(attId);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Receipt', expenseMessage(e));
    }
  };

  if (!claim)
    return (
      <View style={styles.flex}>
        <Stack.Screen options={{ title: 'Expense' }} />
        <View style={styles.content}>
          {q.isError ? (
            <AppText variant="bodyMuted">{expenseMessage(q.error)}</AppText>
          ) : (
            <SkeletonCard />
          )}
        </View>
      </View>
    );

  const edit = (l: Line) =>
    router.push({ pathname: '/expenses/new', params: { claimId: claim.id, lineId: l.id } });

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: monthLabel(claim.month) }} />
      <PullToRefresh onRefresh={() => q.refetch()}>
        <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <Card style={styles.head}>
            <View style={styles.flex}>
              {!mine ? <AppText variant="small">{claim.userName}</AppText> : null}
              <AppText variant="headline" style={styles.navy}>
                {formatINR(claim.total)}
              </AppText>
            </View>
            <Chip label={STATUS_LABEL[claim.status]} tone={STATUS_TONE[claim.status]} />
          </Card>

          <Card style={styles.pad}>
            <AppText variant="label" style={styles.section}>
              Approval
            </AppText>
            <ApprovalTrail claim={claim} />
          </Card>

          {auto.length && editable ? (
            <Card style={[styles.pad, styles.auto]}>
              <AppText variant="label">Auto-filled from your DCR</AppText>
              <AppText variant="body">
                {auto.length} items · {formatINR(autoTotal)}
              </AppText>
              <View style={styles.row}>
                <Button
                  label="Confirm"
                  compact
                  loading={busy === 'confirm'}
                  onPress={() =>
                    run('confirm', async () => {
                      for (const l of auto)
                        await m.save.mutateAsync({
                          line: l,
                          body: {
                            date: l.date,
                            category: l.category,
                            amount: l.amount,
                            notes: l.notes,
                            mileageKm: l.mileageKm,
                            dcrId: l.dcrId,
                            tourPlanId: l.tourPlanId,
                          },
                        });
                    })
                  }
                />
                <Button label="Edit" variant="secondary" compact onPress={() => edit(auto[0]!)} />
                <Button
                  label="Recalculate"
                  variant="tint"
                  compact
                  loading={busy === 'recalc'}
                  onPress={() => run('recalc', () => runAllowances(claim.id, false))}
                />
              </View>
            </Card>
          ) : null}

          {days.map(([date, lines]) => (
            <Card key={date} style={styles.pad}>
              <View style={styles.dayHead}>
                <AppText variant="label">{dateLabel(date)}</AppText>
                <AppText variant="label">
                  {formatINR(lines.reduce((s, l) => s + l.amount, 0))}
                </AppText>
              </View>
              {claim.dcrRejectedDates?.includes(date) ? (
                <AppText variant="small" style={styles.err}>
                  DCR rejected for this day
                </AppText>
              ) : null}
              {lines.map((l) => (
                <Pressable
                  key={l.id}
                  disabled={!editable}
                  onPress={() => edit(l)}
                  style={styles.item}
                  accessibilityRole={editable ? 'button' : undefined}
                >
                  <View style={styles.flex}>
                    <AppText variant="body">{CATEGORY_LABEL[l.category]}</AppText>
                    {l.attachments.length ? (
                      <View style={styles.row}>
                        {l.attachments.map((a, i) => (
                          <Pressable key={a.id} onPress={() => openReceipt(a.id)} hitSlop={8}>
                            <AppText variant="small" style={styles.link}>
                              Receipt {i + 1}
                            </AppText>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <AppText variant="body">{formatINR(l.amount)}</AppText>
                </Pressable>
              ))}
            </Card>
          ))}
          {!days.length ? (
            <Card style={styles.pad}>
              <AppText variant="bodyMuted">No expenses this month yet.</AppText>
            </Card>
          ) : null}

          {mode === 'reject' ? (
            <TextField
              label="Reason for rejection"
              value={reason}
              onChangeText={setReason}
              multiline
            />
          ) : null}
          {mode === 'pay' ? (
            <TextField label="Payment reference" value={payRef} onChangeText={setPayRef} />
          ) : null}
          {error ? <AppText style={styles.err}>{error}</AppText> : null}
          <View style={{ height: spacing.xxl * 2 }} />
        </KeyboardAwareScrollView>
      </PullToRefresh>

      <Bar bottom={bottom}>
        {editable ? (
          <>
            <Button
              label="New expense"
              variant="secondary"
              style={styles.flex}
              onPress={() =>
                router.push({ pathname: '/expenses/new', params: { claimId: claim.id } })
              }
            />
            <Button
              label={claim.status === 'rejected' ? 'Resubmit' : 'Submit'}
              style={styles.flex}
              disabled={!claim.lines.length}
              loading={busy === 'submit'}
              onPress={() => run('submit', () => m.submit.mutateAsync())}
            />
          </>
        ) : canDecide ? (
          mode === 'reject' ? (
            <>
              <Button
                label="Cancel"
                variant="secondary"
                style={styles.flex}
                onPress={() => setMode(null)}
              />
              <Button
                label="Reject"
                style={styles.flex}
                disabled={!reason.trim()}
                loading={busy === 'reject'}
                onPress={() =>
                  run('reject', () =>
                    m.decide.mutateAsync({ decision: 'reject', comment: reason.trim() }),
                  )
                }
              />
            </>
          ) : (
            <View style={styles.flex}>
              {approveBlock ? (
                <AppText variant="small" style={styles.err}>
                  {approveBlock}
                </AppText>
              ) : null}
              <View style={styles.row}>
                <Button
                  label="Reject"
                  variant="secondary"
                  style={styles.flex}
                  onPress={() => setMode('reject')}
                />
                <Button
                  label="Approve"
                  style={styles.flex}
                  disabled={!!approveBlock || recon.isPending}
                  loading={busy === 'approve'}
                  onPress={() =>
                    run('approve', () => m.decide.mutateAsync({ decision: 'approve' }))
                  }
                />
              </View>
            </View>
          )
        ) : canPay ? (
          mode === 'pay' ? (
            <Button
              label="Confirm payment"
              style={styles.flex}
              disabled={!payRef.trim()}
              loading={busy === 'pay'}
              onPress={() => run('pay', () => m.pay.mutateAsync(payRef.trim()))}
            />
          ) : (
            <Button label="Mark paid" style={styles.flex} onPress={() => setMode('pay')} />
          )
        ) : null}
      </Bar>
    </View>
  );
}

function Bar({ bottom, children }: { bottom: number; children: React.ReactNode }) {
  if (!children) return null;
  return <View style={[styles.bar, { paddingBottom: bottom + spacing.sm }]}>{children}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: layout.gutter, gap: spacing.md },
  pad: { padding: spacing.lg, gap: spacing.sm },
  head: { padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  navy: { color: colors.brandNavyCore },
  section: { marginBottom: spacing.sm },
  auto: { borderLeftWidth: 4, borderLeftColor: colors.brandTeal, borderRadius: radius.md },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  link: { color: colors.tealDeep, fontFamily: fonts.semibold },
  err: { color: colors.danger },
  bar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
});
