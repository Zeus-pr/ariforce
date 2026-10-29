import type { Dcr } from '@ariforce/contracts';
import { useQueries } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Linking, RefreshControl, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { DecisionBar } from '@/components/approvals/decision-bar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Field, dcrStyles } from '@/components/dcr/field';
import { LineForm } from '@/components/expenses/line-form';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { SelectSheet } from '@/components/masters/select-sheet';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { SkeletonCard, SkeletonList } from '@/components/skeleton';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { reviewOf } from '@/lib/dcr/adapter';
import { dateLabel } from '@/lib/dcr/dates';
import {
  CATEGORY_LABEL,
  MAX_FILES,
  STATUS_LABEL,
  STATUS_TONE,
  type AllowanceResult,
  type Line,
  checkFile,
  deleteReceipt,
  expenseMessage,
  isEditable,
  monthLabel,
  receiptUrl,
  runAllowances,
  uploadReceipt,
  useClaim,
  useLineMutations,
  usePlaces,
} from '@/lib/expenses';
import { getDocumentPicker, getImagePicker, pickDocument, pickPhoto } from '@/lib/file-pickers';
import { formatINR } from '@/lib/money';
import { isApprover } from '@/lib/roles';
import { colors, layout, spacing } from '@/theme';

const daysOfMonth = (m: string) => {
  const n = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`);
};

/** One month's claim: the rep edits and submits it; a manager reviews and decides it. */
export default function ClaimScreen() {
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const { user } = useAuth();
  const bottom = useBottomSpace();
  const q = useClaim(id);
  const m = useLineMutations(id);
  const claim = q.data;
  const mine = !!claim && claim.userId === user?.id;
  const editable = mine && !!claim && isEditable(claim.status);
  const reviewing =
    !!claim && !mine && claim.status === 'submitted' && isApprover(user?.roles ?? []);

  const [onlyDay, setOnlyDay] = useState<string | null>(date ?? null);
  const [editing, setEditing] = useState<Line | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [preview, setPreview] = useState<AllowanceResult | null>(null);
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [placeFor, setPlaceFor] = useState<string | null>(null);
  const [tadaBusy, setTadaBusy] = useState(false);
  const placesQ = usePlaces(!!preview);

  // That day's DCR for each line (linking + the manager's "DCR approved" check).
  const dcrIds = useMemo(
    () => [...new Set((claim?.lines ?? []).map((l) => l.dcrId).filter((x): x is string => !!x))],
    [claim],
  );
  const dcrQs = useQueries({
    queries: dcrIds.map((d) => ({
      queryKey: ['dcr', 'one', d],
      queryFn: ({ signal }: { signal: AbortSignal }) => apiFetch<Dcr>(`/v1/dcrs/${d}`, { signal }),
    })),
  });
  const dcrById = new Map(dcrQs.flatMap((r) => (r.data ? [[r.data.id, r.data] as const] : [])));
  const dcrByDate = new Map([...dcrById.values()].map((d) => [d.date, d.id]));
  const notApproved = [...dcrById.values()].filter((d) => reviewOf(d).status !== 'approved');
  const rejectedDcr = (l: Line) => {
    const d = l.dcrId ? dcrById.get(l.dcrId) : undefined;
    return !!d && reviewOf(d).status === 'rejected';
  };

  const lines = useMemo(
    () =>
      [...(claim?.lines ?? [])]
        .filter((l) => !onlyDay || l.date === onlyDay)
        .sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category)),
    [claim, onlyDay],
  );
  const canPhoto = getImagePicker() != null;
  const canFile = getDocumentPicker() != null;

  async function attach(l: Line, how: 'camera' | 'photo' | 'file') {
    try {
      const f = how === 'file' ? await pickDocument() : await pickPhoto(how === 'camera');
      if (!f) return;
      const bad = checkFile(f, l.attachments.length);
      if (bad) return Alert.alert('Can’t attach', bad);
      setBusyLine(l.id);
      await uploadReceipt(id, l.id, f);
      m.refresh();
    } catch (e) {
      Alert.alert('Upload failed', expenseMessage(e));
    } finally {
      setBusyLine(null);
    }
  }

  const attachMenu = (l: Line) =>
    Alert.alert('Attach receipt', undefined, [
      ...(canPhoto
        ? [
            { text: 'Take photo', onPress: () => void attach(l, 'camera') },
            { text: 'Choose photo', onPress: () => void attach(l, 'photo') },
          ]
        : []),
      ...(canFile ? [{ text: 'Choose file', onPress: () => void attach(l, 'file') }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  async function tada(apply: boolean) {
    setTadaBusy(true);
    setError(null);
    try {
      const r = await runAllowances(id, !apply, places);
      if (apply) {
        setPreview(null);
        m.refresh();
      } else setPreview(r);
    } catch (e) {
      setError(expenseMessage(e));
    } finally {
      setTadaBusy(false);
    }
  }

  const submit = () =>
    Alert.alert(
      'Submit claim?',
      `${monthLabel(claim!.month)}, ${formatINR(claim!.total)}. You can’t edit it while it is waiting for approval.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: () =>
            m.submit.mutate(undefined, {
              onSuccess: () => Alert.alert('Submitted', 'Your manager will review it.'),
              onError: (e) => setError(expenseMessage(e)),
            }),
        },
      ],
    );

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: claim ? monthLabel(claim.month) : 'Expense claim' }} />
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={q.isRefetching && !q.isPending}
            onRefresh={() => void q.refetch()}
            tintColor={colors.navy}
            colors={[colors.navy]}
          />
        }
      >
        {q.isPending ? (
          <>
            <SkeletonCard lines={2} />
            <SkeletonList count={3} />
          </>
        ) : q.isError || !claim ? (
          <Card style={styles.pad}>
            <AppText variant="bodyMuted">{expenseMessage(q.error)}</AppText>
          </Card>
        ) : (
          <>
            <Card style={styles.pad}>
              <View style={styles.row}>
                <AppText variant="label" style={styles.flex}>
                  {mine ? 'My claim' : claim.userName}
                </AppText>
                <Chip label={STATUS_LABEL[claim.status]} tone={STATUS_TONE[claim.status]} />
              </View>
              <AppText variant="count">{formatINR(claim.total)}</AppText>
              <AppText variant="small">
                {claim.lines.length} {claim.lines.length === 1 ? 'line' : 'lines'}
              </AppText>
              {claim.rejectionReason && claim.status === 'rejected' ? (
                <AppText variant="bodyMuted">Sent back: {claim.rejectionReason}</AppText>
              ) : null}
              {claim.lines.some(rejectedDcr) ? (
                <Chip label="Has a day whose DCR was rejected" tone="red" />
              ) : null}
            </Card>

            {onlyDay ? (
              <Button
                label={`Showing ${dateLabel(onlyDay)} · show whole month`}
                variant="secondary"
                compact
                onPress={() => setOnlyDay(null)}
              />
            ) : null}

            {lines.map((l) => (
              <Card key={l.id} style={styles.pad}>
                <View style={styles.row}>
                  <AppText variant="label" style={styles.flex}>
                    {dateLabel(l.date)} · {CATEGORY_LABEL[l.category]}
                  </AppText>
                  <AppText variant="label">{formatINR(l.amount)}</AppText>
                </View>
                {l.source === 'auto' ? (
                  <AppText variant="small">TA/DA from your DCR</AppText>
                ) : null}
                {l.mileageKm != null ? <AppText variant="small">{l.mileageKm} km</AppText> : null}
                {l.notes ? <AppText variant="bodyMuted">{l.notes}</AppText> : null}
                {rejectedDcr(l) ? <Chip label="DCR rejected" tone="red" /> : null}
                {l.attachments.map((a, ai) => (
                  <View key={a.id} style={styles.row}>
                    <Button
                      label={`Receipt ${ai + 1}${a.status === 'pending' ? ' (uploading)' : ''}`}
                      variant="secondary"
                      compact
                      style={styles.flex}
                      onPress={() =>
                        void receiptUrl(a.id)
                          .then((u) => Linking.openURL(u))
                          .catch((e) => Alert.alert('Can’t open', expenseMessage(e)))
                      }
                    />
                    {editable ? (
                      <Button
                        label="Remove"
                        variant="secondary"
                        compact
                        onPress={() =>
                          void deleteReceipt(a.id)
                            .then(m.refresh)
                            .catch((e) => Alert.alert('Can’t remove', expenseMessage(e)))
                        }
                      />
                    ) : null}
                  </View>
                ))}
                {editable ? (
                  <View style={styles.row}>
                    {(canPhoto || canFile) && l.attachments.length < MAX_FILES ? (
                      <Button
                        label="Attach receipt"
                        variant="secondary"
                        compact
                        style={styles.flex}
                        loading={busyLine === l.id}
                        loadingLabel="Uploading…"
                        onPress={() => attachMenu(l)}
                      />
                    ) : null}
                    {l.source !== 'auto' ? (
                      <>
                        <Button
                          label="Edit"
                          variant="secondary"
                          compact
                          onPress={() => setEditing(l)}
                        />
                        <Button
                          label="Delete"
                          variant="secondary"
                          compact
                          onPress={() =>
                            Alert.alert(
                              'Delete line?',
                              `${CATEGORY_LABEL[l.category]}, ${formatINR(l.amount)}`,
                              [
                                { text: 'Keep', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: () =>
                                    m.remove.mutate(l.id, {
                                      onError: (e) => setError(expenseMessage(e)),
                                    }),
                                },
                              ],
                            )
                          }
                        />
                      </>
                    ) : null}
                  </View>
                ) : null}
              </Card>
            ))}
            {!lines.length ? (
              <Card style={styles.pad}>
                <AppText variant="bodyMuted">No lines yet.</AppText>
              </Card>
            ) : null}

            {editable && editing ? (
              <LineForm
                dates={daysOfMonth(claim.month)}
                line={editing === 'new' ? undefined : editing}
                initialDate={onlyDay ?? undefined}
                busy={m.save.isPending}
                error={error}
                dcrIdFor={(d) => dcrByDate.get(d) ?? null}
                onCancel={() => setEditing(null)}
                onSave={(body) =>
                  m.save.mutate(
                    { line: editing === 'new' ? undefined : editing, body },
                    {
                      onSuccess: () => setEditing(null),
                      onError: (e) => setError(expenseMessage(e)),
                    },
                  )
                }
              />
            ) : null}

            {editable && preview ? (
              <Card style={styles.pad}>
                <AppText variant="label">TA/DA preview</AppText>
                <AppText variant="body">
                  TA {formatINR(preview.totals.ta)} · DA {formatINR(preview.totals.da)} ·{' '}
                  {preview.totals.km} km
                </AppText>
                {preview.days
                  .filter((d) => d.issues.includes('place_required') || places[d.date])
                  .map((d) => (
                    <Field
                      key={d.date}
                      label={`Place for ${dateLabel(d.date)}`}
                      value={
                        placesQ.data?.find((p) => p.id === (places[d.date] ?? d.placeId))?.name
                      }
                      placeholder="Choose place"
                      onPress={() => setPlaceFor(d.date)}
                    />
                  ))}
                {preview.days.some((d) => d.issues.includes('no_rate')) ? (
                  <AppText variant="small">
                    Some days have no allowance rate set; ask admin.
                  </AppText>
                ) : null}
                <View style={styles.row}>
                  <Button
                    label="Cancel"
                    variant="secondary"
                    compact
                    style={styles.flex}
                    onPress={() => setPreview(null)}
                  />
                  <Button
                    label="Apply"
                    compact
                    style={styles.flex}
                    loading={tadaBusy}
                    onPress={() => void tada(true)}
                  />
                </View>
              </Card>
            ) : null}

            {error && !editing ? (
              <AppText variant="caption" style={dcrStyles.err}>
                {error}
              </AppText>
            ) : null}

            {editable ? (
              <>
                {!editing ? (
                  <Button label="Add line" variant="secondary" onPress={() => setEditing('new')} />
                ) : null}
                {!preview ? (
                  <Button
                    label="Recalculate TA/DA"
                    variant="secondary"
                    loading={tadaBusy}
                    loadingLabel="Calculating…"
                    onPress={() => void tada(false)}
                  />
                ) : null}
                <Button
                  label={claim.status === 'rejected' ? 'Resubmit claim' : 'Submit claim'}
                  loading={m.submit.isPending}
                  loadingLabel="Submitting…"
                  onPress={submit}
                />
              </>
            ) : null}

            {reviewing ? (
              <DecisionBar
                what={`${claim.userName}'s ${monthLabel(claim.month)} claim (${formatINR(claim.total)})`}
                busy={m.decide.isPending}
                error={error}
                // Server rule: expense approval waits for that day's DCR approval (DCR_NOT_APPROVED).
                approveBlocked={
                  notApproved.length
                    ? `DCR not approved yet (${notApproved.map((d) => dateLabel(d.date)).join(', ')}).`
                    : dcrQs.some((r) => r.isPending)
                      ? 'Checking DCR approvals…'
                      : null
                }
                onDecide={(decision, reason) =>
                  m.decide.mutate(
                    { decision, comment: reason ?? undefined },
                    { onError: (e) => setError(expenseMessage(e)) },
                  )
                }
              />
            ) : null}
          </>
        )}
      </KeyboardAwareScrollView>
      <SelectSheet
        visible={!!placeFor}
        title="Place"
        options={(placesQ.data ?? []).map((p) => ({
          value: p.id,
          label: p.name,
          hint: `${p.km} km`,
        }))}
        value={placeFor ? (places[placeFor] ?? null) : null}
        onPick={(v) => placeFor && v && setPlaces((x) => ({ ...x, [placeFor]: v }))}
        onClose={() => setPlaceFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  pad: { padding: spacing.lg, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
