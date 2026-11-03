import type { Approval, Dcr } from '@ariforce/contracts';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { PullToRefresh } from '@/components/refresh';
import { AppText } from '@/components/app-text';
import { DecisionBar } from '@/components/approvals/decision-bar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Field, dcrStyles } from '@/components/dcr/field';
import { DayClaimCard } from '@/components/expenses/day-claim-card';
import { LineForm } from '@/components/expenses/line-form';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { SelectSheet } from '@/components/masters/select-sheet';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { Skeleton, SkeletonCard, SkeletonList } from '@/components/skeleton';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { reviewOf, useTeamNames } from '@/lib/dcr/adapter';
import { dateLabel } from '@/lib/dcr/dates';
import { useDcrOptions, useDcrTerritories } from '@/lib/dcr/api';
import { normaliseWorkTypes, territoryRows, type CallKind } from '@/lib/dcr/model';
import {
  CATEGORY_LABEL,
  MAX_FILES,
  STATUS_LABEL,
  STATUS_TONE,
  type AllowanceResult,
  type Line,
  checkFile,
  claimDcrRejected,
  lineDcrRejected,
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
import { layout, spacing } from '@/theme';
import { todayIST } from '@/lib/dcr/dates';

const OUTLET_PATH: Record<CallKind, string> = {
  doctor: '/v1/doctors',
  chemist: '/v1/chemists',
  stockist: '/v1/stockists',
};

const daysOfMonth = (m: string) => {
  const n = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`);
};

/** One month's claim: day cards (auto TA/DA + manual boxes) like the field statement. */
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

  // Expenses are 2-step (BM → ABM, then RBM). Only the current step's approver (or above) may decide.
  const myTurnQ = useQuery({
    queryKey: ['approvals', 'expense', 'to_decide', claim?.approvalId],
    enabled: reviewing && !!claim?.approvalId,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      apiFetch<{ items: Approval[] }>('/v1/approvals', {
        signal,
        query: { mine: 'to_decide', subjectType: 'expense', status: 'pending', limit: 100 },
      }).then((r) =>
        r.items.some((a) => a.id === claim!.approvalId || a.subjectId === claim!.id),
      ),
  });
  const myTurn = myTurnQ.data === true;

  const [onlyDay, setOnlyDay] = useState<string | null>(date ?? null);
  const [editing, setEditing] = useState<Line | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [dayBusy, setDayBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<AllowanceResult | null>(null);
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [placeFor, setPlaceFor] = useState<string | null>(null);
  const [tadaBusy, setTadaBusy] = useState(false);
  const placesQ = usePlaces(!!preview);
  const optionsQ = useDcrOptions(todayIST());
  const terrQ = useDcrTerritories(true);

  const wtName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of normaliseWorkTypes(optionsQ.data?.workTypes ?? [])) map.set(w.id, w.name);
    return map;
  }, [optionsQ.data]);
  const terrName = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of territoryRows(terrQ.data ?? [])) map.set(r.id, r.name);
    return map;
  }, [terrQ.data]);

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
  const dcrByDate = new Map([...dcrById.values()].map((d) => [d.date, d]));
  const notApproved = [...dcrById.values()].filter((d) => reviewOf(d).status !== 'approved');
  const rejectedDcr = (l: Line) =>
    lineDcrRejected(l, () => {
      const d = l.dcrId ? dcrById.get(l.dcrId) : undefined;
      return !!d && reviewOf(d).status === 'rejected';
    });

  const dcrList = useMemo(() => [...dcrById.values()], [dcrById]);
  const outletRefs = useMemo(() => {
    const seen = new Map<string, { kind: CallKind; id: string }>();
    for (const d of dcrList) {
      for (const c of d.calls ?? []) {
        if (!c.outletKind || !c.outletId) continue;
        const k = `${c.outletKind}:${c.outletId}`;
        if (!seen.has(k)) seen.set(k, { kind: c.outletKind, id: c.outletId });
      }
    }
    return [...seen.values()];
  }, [dcrList]);

  const outletQs = useQueries({
    queries: outletRefs.map((o) => ({
      queryKey: ['outlet', o.kind, o.id],
      staleTime: 10 * 60_000,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiFetch<{ name: string }>(`${OUTLET_PATH[o.kind]}/${o.id}`, { signal }),
    })),
  });
  const outletNames = useMemo(() => {
    const m = new Map<string, string>();
    outletRefs.forEach((o, i) => {
      const n = outletQs[i]?.data?.name?.trim();
      if (n) m.set(o.id, n);
    });
    return m;
  }, [outletRefs, outletQs]);

  const namesQ = useTeamNames(dcrIds.length > 0);

  const linesByDate = useMemo(() => {
    const map = new Map<string, Line[]>();
    for (const l of claim?.lines ?? []) {
      if (onlyDay && l.date !== onlyDay) continue;
      const list = map.get(l.date) ?? [];
      list.push(l);
      map.set(l.date, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [claim, onlyDay]);

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

  async function saveDay(dateKey: string, ops: {
    upserts: { line?: Line; body: import('@/lib/expenses').LineInput }[];
    removes: string[];
  }) {
    setDayBusy(dateKey);
    setError(null);
    try {
      for (const lineId of ops.removes) await m.remove.mutateAsync(lineId);
      for (const u of ops.upserts) await m.save.mutateAsync(u);
      m.refresh();
    } catch (e) {
      setError(expenseMessage(e));
    } finally {
      setDayBusy(null);
    }
  }

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title: claim ? monthLabel(claim.month) : 'Expense claim' }} />
      <PullToRefresh onRefresh={() => q.refetch()}>
        <KeyboardAwareScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
          keyboardShouldPersistTaps="handled"
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
                  <AppText variant="label" style={styles.flexGrow}>
                    {mine ? user?.name?.trim() || 'My claim' : claim.userName}
                  </AppText>
                  <Chip label={STATUS_LABEL[claim.status]} tone={STATUS_TONE[claim.status]} />
                </View>
                <AppText variant="count">{formatINR(claim.total)}</AppText>
                <AppText variant="small">
                  {claim.lines.length} {claim.lines.length === 1 ? 'line' : 'lines'} ·{' '}
                  {monthLabel(claim.month)}
                </AppText>
                {claim.rejectionReason && claim.status === 'rejected' ? (
                  <AppText variant="bodyMuted">Sent back: {claim.rejectionReason}</AppText>
                ) : null}
                {claimDcrRejected(claim, () => claim.lines.some(rejectedDcr)) ? (
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

              {linesByDate.map(([d, dayLines]) => {
                const dcr = dcrByDate.get(d) ?? (dayLines[0]?.dcrId ? dcrById.get(dayLines[0].dcrId) : null);
                return (
                  <View key={d} style={styles.dayBlock}>
                    <DayClaimCard
                      date={d}
                      lines={dayLines}
                      dcr={dcr}
                      workTypeName={dcr ? wtName.get(dcr.workTypeId) : undefined}
                      territoryNames={dcr?.territoryIds.map((t) => terrName.get(t) ?? t)}
                      outletNames={outletNames}
                      personNames={namesQ.data}
                      editable={editable}
                      busy={dayBusy === d}
                      error={dayBusy === d ? error : null}
                      onSaveManual={(ops) => void saveDay(d, ops)}
                    />
                    {dayLines.some((l) => l.attachments.length) || editable ? (
                      <Card style={styles.attachCard}>
                        <AppText variant="label">
                          {reviewing || !mine ? 'Receipts & attachments' : 'Attachments'}
                        </AppText>
                        {dayLines
                          .filter(
                            (l) =>
                              l.attachments.length > 0 ||
                              (editable &&
                                l.source !== 'auto' &&
                                !(l.notes ?? '').includes('[SFC TA]') &&
                                !(l.notes ?? '').includes('[SFC DA]')),
                          )
                          .map((l) => (
                            <View key={l.id} style={styles.attachBlock}>
                              <AppText variant="small">
                                {CATEGORY_LABEL[l.category]}
                                {l.source === 'auto' || (l.notes ?? '').includes('[SFC')
                                  ? ' · TA/DA'
                                  : ''}{' '}
                                · {formatINR(l.amount)}
                              </AppText>
                              {l.attachments.length ? (
                                l.attachments.map((a, ai) => (
                                  <View key={a.id} style={styles.row}>
                                    <Button
                                      label={`Open receipt ${ai + 1}${a.status === 'pending' ? ' (uploading)' : ''}`}
                                      variant="secondary"
                                      compact
                                      style={styles.flexGrow}
                                      onPress={() =>
                                        void receiptUrl(a.id)
                                          .then((u) => Linking.openURL(u))
                                          .catch((e) =>
                                            Alert.alert('Can’t open', expenseMessage(e)),
                                          )
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
                                            .catch((e) =>
                                              Alert.alert('Can’t remove', expenseMessage(e)),
                                            )
                                        }
                                      />
                                    ) : null}
                                  </View>
                                ))
                              ) : reviewing || !mine ? (
                                <AppText variant="bodyMuted">No receipt on this line.</AppText>
                              ) : null}
                              {busyLine === l.id ? (
                                <View
                                  style={styles.uploading}
                                  accessibilityLabel="Uploading receipt"
                                >
                                  <Skeleton width={40} height={40} rounded={8} />
                                  <AppText variant="small">Uploading receipt…</AppText>
                                </View>
                              ) : null}
                              {editable &&
                              (canPhoto || canFile) &&
                              l.attachments.length < MAX_FILES ? (
                                <Button
                                  label="Attach receipt"
                                  variant="secondary"
                                  compact
                                  disabled={busyLine === l.id}
                                  onPress={() => attachMenu(l)}
                                />
                              ) : null}
                            </View>
                          ))}
                        {!dayLines.some((l) => l.attachments.length) && (reviewing || !mine) ? (
                          <AppText variant="bodyMuted">No receipts uploaded for this day.</AppText>
                        ) : null}
                      </Card>
                    ) : null}
                  </View>
                );
              })}

              {!linesByDate.length ? (
                <Card style={styles.pad}>
                  <AppText variant="body">No days on this claim yet</AppText>
                  <AppText variant="bodyMuted">
                    Recalculate TA/DA from your DCRs, or add a line for hotel / food / other.
                  </AppText>
                </Card>
              ) : null}

              {editable && editing ? (
                <LineForm
                  dates={daysOfMonth(claim.month)}
                  line={editing === 'new' ? undefined : editing}
                  initialDate={onlyDay ?? undefined}
                  busy={m.save.isPending}
                  error={error}
                  dcrIdFor={(d) => dcrByDate.get(d)?.id ?? null}
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
                      style={styles.flexGrow}
                      onPress={() => setPreview(null)}
                    />
                    <Button
                      label="Apply"
                      compact
                      style={styles.flexGrow}
                      loading={tadaBusy}
                      onPress={() => void tada(true)}
                    />
                  </View>
                </Card>
              ) : null}

              {error && !editing && !dayBusy ? (
                <AppText variant="caption" style={dcrStyles.err}>
                  {error}
                </AppText>
              ) : null}

              {editable ? (
                <>
                  {!editing ? (
                    <Button
                      label="Add hotel / food / other line"
                      variant="secondary"
                      onPress={() => setEditing('new')}
                    />
                  ) : null}
                  {!preview ? (
                    <Button
                      label="Recalculate TA/DA from DCRs"
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

              {reviewing && myTurn ? (
                <DecisionBar
                  what={`${claim.userName}'s ${monthLabel(claim.month)} claim (${formatINR(claim.total)})`}
                  busy={m.decide.isPending}
                  error={error}
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
              {reviewing && !myTurn && !myTurnQ.isPending ? (
                <Card style={styles.pad}>
                  <AppText variant="label">Waiting for another approver</AppText>
                  <AppText variant="bodyMuted">
                    Expense claims need two managers in the reporting line (step{' '}
                    {claim.approvalStep ?? '—'}). This one is with a different approver right now —
                    your turn comes after theirs, or ask the assigned manager to decide.
                  </AppText>
                </Card>
              ) : null}
            </>
          )}
        </KeyboardAwareScrollView>
      </PullToRefresh>
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
  flexGrow: { flex: 1 },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.md },
  pad: { padding: spacing.lg, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  uploading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dayBlock: { gap: spacing.sm },
  attachCard: { padding: spacing.md, gap: spacing.sm },
  attachBlock: { gap: spacing.sm, paddingTop: spacing.xs },
});
