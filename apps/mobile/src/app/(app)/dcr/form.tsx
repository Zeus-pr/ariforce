import type { Dcr } from '@ariforce/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { LeaveFields } from '@/components/dcr/leave-fields';
import { MultiSelectSheet } from '@/components/dcr/multi-select-sheet';
import { SfcRouteCard, candidateFacts } from '@/components/dcr/sfc-route-card';
import { TimeField } from '@/components/dcr/time-field';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { SelectSheet } from '@/components/masters/select-sheet';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { TextField } from '@/components/text-field';
import { ApiError, apiFetch } from '@/lib/api';
import {
  fetchSfcMatch,
  idempotencyKey,
  useDeleteDraft,
  useDcrRecord,
  useDcrOptions,
  useDcrTerritories,
  useProducts,
  useSaveDraft,
  useSubmitDcr,
  useWorkWith,
} from '@/lib/dcr/api';
import { dateLabel, nowHHmm, todayIST } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { bandOf } from '@/lib/dcr/bands';
import {
  BANDS,
  KIND_LABEL,
  SAVED_CUSTOMER,
  callsFromDcr,
  cleanSfcHqs,
  emptyMeeting,
  emptyOffice,
  hqIdsOf,
  normaliseWorkTypes,
  problems as findProblems,
  territoryRows,
  workOnChoices,
  workOnFor,
  type CallDraft,
  type CallKind,
  type FlowState,
  type WorkTypeOption,
} from '@/lib/dcr/model';
import { colors, fonts, layout, radius, spacing, touch, type } from '@/theme';

const MEETING_TYPES = [
  'Cycle meeting',
  'Area review',
  'Regional review',
  'Conference or CME',
  'Team meeting',
];
const TRAINING_TYPES = [
  'Product training',
  'Induction',
  'Field skills workshop',
  'Compliance training',
  'Refresher training',
];
const ADMIN_TASKS = [
  'Expense filing',
  'Stock reconciliation',
  'Reports and MIS',
  'Office visit',
  'Bank or courier work',
];

const fresh = (date: string): FlowState => ({
  date,
  workOn: undefined,
  workTypeId: '',
  territoryIds: [],
  workWith: [],
  workWithDone: false,
  sfc: { state: 'idle', hqs: [] },
  routeChoice: {},
  calls: [],
  meeting: emptyMeeting(),
  office: emptyOffice(),
  leaveRequestId: '',
  deviationReason: '',
});

/**
 * One DCR report (web dcr-flow.tsx): progressive sections on a scroll, draft save / submit / delete.
 */
export default function DcrFormScreen() {
  const { id, date: dateParam, new: isNew } = useLocalSearchParams<{
    id?: string;
    date?: string;
    new?: string;
  }>();
  const today = todayIST();
  const initialDate = (typeof dateParam === 'string' && dateParam) || today;
  const reportId = typeof id === 'string' && id ? id : undefined;
  const creating = isNew === '1' || !reportId;

  return (
    <DcrForm
      key={`${reportId ?? 'new'}-${initialDate}`}
      today={today}
      initialDate={initialDate}
      reportId={reportId}
      dateLocked={!creating}
    />
  );
}

function DcrForm({
  today,
  initialDate,
  reportId,
  dateLocked,
}: {
  today: string;
  initialDate: string;
  reportId?: string;
  dateLocked: boolean;
}) {
  const router = useRouter();
  const bottom = useBottomSpace();
  const [s, setS] = useState<FlowState>(() => fresh(initialDate));
  const [dcr, setDcr] = useState<Dcr | null>(null);
  const [workTypes, setWorkTypes] = useState<WorkTypeOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [daySubmitted, setDaySubmitted] = useState<{ id: string | null } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [askDeviation, setAskDeviation] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [peopleQ, setPeopleQ] = useState('');
  const [sheet, setSheet] = useState<
    | null
    | 'workOn'
    | 'band'
    | 'territory'
    | 'workWith'
    | 'date'
    | 'route'
    | { call: string; field: 'outlet' | 'time' | 'products' | 'kind' }
    | { meeting: 'title' | 'mode' | 'type' }
    | { office: 'type' }
  >(null);
  const [routeHq, setRouteHq] = useState<string | null>(null);
  const submitKey = useRef<string | null>(null);
  const lastFieldWt = useRef('');
  const names = useRef(new Map<string, string>());
  const optionsQ = useDcrOptions(s.date);
  const recordQ = useDcrRecord(reportId);
  const field = s.workOn?.branch === 'field';
  const terrQ = useDcrTerritories(!!field);
  const peopleQry = useWorkWith(!!field && s.territoryIds.length > 0, peopleQ);
  const productsQ = useProducts(!!field);
  const saveDraft = useSaveDraft();
  const submitMut = useSubmitDcr();
  const deleteMut = useDeleteDraft();

  const choices = useMemo(
    () => workOnChoices(workTypes ?? []),
    [workTypes],
  );
  const rows = useMemo(() => territoryRows(terrQ.data ?? []), [terrQ.data]);
  const placeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.id, r.name);
    return m;
  }, [rows]);
  const personName = useMemo(() => {
    const m = new Map(names.current);
    for (const p of peopleQry.data ?? []) m.set(p.id, p.name);
    return m;
  }, [peopleQry.data]);

  const blocked = !!daySubmitted && dcr?.status !== 'submitted';
  const readOnly =
    dcr?.status === 'submitted' || dcr?.status === 'locked' || blocked;
  const busy = !!saving || saveDraft.isPending || submitMut.isPending || deleteMut.isPending;

  // Hydrate from options + optional record
  useEffect(() => {
    if (!optionsQ.data) {
      if (optionsQ.isError) setLoadError(saveMessage(optionsQ.error));
      return;
    }
    const wts = normaliseWorkTypes(optionsQ.data.workTypes);
    setWorkTypes(wts);
    setLoadError(null);
    const sub = optionsQ.data.submitted ?? null;
    let d: Dcr | null = null;
    if (reportId) {
      d =
        (optionsQ.data.drafts ?? []).find((x) => x.id === reportId) ??
        (sub?.id === reportId ? sub : null) ??
        recordQ.data ??
        null;
      if (recordQ.isError && !d) {
        setLoadError('This draft no longer exists. It may have been deleted on another device.');
        return;
      }
      if (reportId && !d && (recordQ.isPending || optionsQ.isPending)) return;
    }
    if (sub && sub.id !== d?.id) setDaySubmitted({ id: sub.id });
    setDcr(d);
    const next = fresh(s.date);
    if (d) {
      const wo = workOnFor(workOnChoices(wts), d.workTypeId);
      next.workOn = wo;
      next.workTypeId = d.workTypeId;
      next.territoryIds = d.territoryIds;
      next.workWith = d.workWithUserIds;
      next.workWithDone = wo?.branch === 'field' && d.territoryIds.length > 0;
      next.routeChoice = Object.fromEntries(
        d.sfcRoutes.map((x) => [x.hqTerritoryId, x.sfcRouteId]),
      );
      next.calls = callsFromDcr(d, names.current);
      const det = d.details;
      if (det?.kind === 'meeting' || det?.kind === 'training')
        next.meeting = {
          title: det.title,
          mode: det.mode,
          location: det.location ?? '',
          startTime: det.startTime,
          durationMin: String(det.durationMin),
          attendees: det.kind === 'meeting' ? (det.attendees ?? '') : '',
          remarks: det.remarks ?? '',
          trainer: det.kind === 'training' ? (det.trainer ?? '') : '',
        };
      if (det?.kind === 'office')
        next.office = {
          taskType: det.taskType,
          description: det.description,
          startTime: det.startTime ?? '',
          durationMin: String(det.durationMin),
          remarks: det.remarks ?? '',
        };
      if (det?.kind === 'leave') next.leaveRequestId = det.leaveRequestId;
      next.deviationReason = d.deviationReason ?? '';
      setAskDeviation(!!d.deviationReason);
      if (d.status === 'submitted' || d.status === 'locked') {
        next.sfc = { state: 'ok', hqs: [] };
      }
    }
    setS(next);
    // Only when options/record settle for this date/id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsQ.data, recordQ.data, reportId]);

  // Resolve saved customer names
  useEffect(() => {
    const missing = s.calls.filter(
      (c) => c.outletId && (!c.outletName || c.outletName === SAVED_CUSTOMER),
    );
    if (!missing.length) return;
    let live = true;
    void (async () => {
      const found = new Map<string, string>();
      await Promise.allSettled(
        missing.map(async (c) => {
          const path =
            c.kind === 'doctor'
              ? `/v1/doctors/${c.outletId}`
              : c.kind === 'chemist'
                ? `/v1/chemists/${c.outletId}`
                : `/v1/stockists/${c.outletId}`;
          try {
            const row = await apiFetch<{ id: string; name: string }>(path);
            found.set(row.id, row.name);
          } catch {
            /* keep placeholder */
          }
        }),
      );
      if (!live || !found.size) return;
      found.forEach((n, id) => names.current.set(id, n));
      setS((x) => ({
        ...x,
        calls: x.calls.map((c) =>
          found.has(c.outletId) ? { ...c, outletName: found.get(c.outletId)! } : c,
        ),
      }));
    })();
    return () => {
      live = false;
    };
  }, [dcr?.id, dcr?.version]);

  // SFC match
  const sfcKey =
    field && s.workTypeId && s.territoryIds.length && s.workWithDone && !readOnly
      ? `${s.date}|${s.workTypeId}|${s.territoryIds.join(',')}`
      : '';
  useEffect(() => {
    if (!sfcKey) return;
    let live = true;
    setS((x) => ({ ...x, sfc: { state: 'loading', hqs: [] } }));
    const [date, workTypeId, territoryIds] = sfcKey.split('|') as [string, string, string];
    void fetchSfcMatch(date, workTypeId, territoryIds.split(',')).then((r) => {
      if (!live) return;
      if (r.ok) {
        const band =
          bandOf(r.band) ??
          bandOf((workTypes ?? []).find((w) => w.id === workTypeId)?.band);
        const hqs = cleanSfcHqs(r.hqs, band);
        const empty = hqs.filter((h) => !h.candidates.length);
        if (empty.length)
          return setS((x) => ({ ...x, sfc: { state: 'no_match', hqs: [] } }));
        return setS((x) => ({ ...x, sfc: { state: 'ok', hqs } }));
      }
      if (r.code === 'SFC_NO_MATCH')
        return setS((x) => ({ ...x, sfc: { state: 'no_match', hqs: [] } }));
      setS((x) => ({ ...x, sfc: { state: 'error', hqs: [] } }));
    });
    return () => {
      live = false;
    };
  }, [sfcKey, workTypes]);

  const update = (patch: Partial<FlowState> | ((x: FlowState) => Partial<FlowState>)) => {
    setS((x) => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) }));
    setFormError(null);
  };

  const chooseWorkOn = (key: string) => {
    const wo = choices.find((c) => c.key === key);
    if (!wo) return;
    update((x) => {
      if (x.workOn?.branch === 'field') lastFieldWt.current = x.workTypeId;
      if (wo.branch !== 'field')
        return { workOn: wo, workTypeId: wo.workTypes[0]!.id };
      return {
        workOn: wo,
        workTypeId: x.workOn?.branch === 'field' ? x.workTypeId : lastFieldWt.current,
      };
    });
  };

  const chooseBand = (workTypeId: string) =>
    update((x) =>
      x.workTypeId === workTypeId
        ? {}
        : {
            workTypeId,
            territoryIds: [],
            workWith: [],
            workWithDone: false,
            sfc: { state: 'idle', hqs: [] },
            routeChoice: {},
          },
    );

  const chooseTerritories = (ids: string[]) =>
    update((x) => {
      const hq = new Set(hqIdsOf(rows, ids));
      return {
        territoryIds: ids,
        workWith: [],
        workWithDone: false,
        sfc: { state: 'idle', hqs: [] },
        routeChoice: {},
        calls: x.calls.map((c) =>
          c.hqId && !hq.has(c.hqId)
            ? { ...c, outletId: '', outletName: '', hqId: '' }
            : c,
        ),
      };
    });

  const probs = findProblems(s);
  const err = (key: string) =>
    showErrors ? probs.filter((p) => p.key === key).map((p) => p.text) : [];

  async function save(submit: boolean) {
    if (readOnly) return;
    if (submit && probs.length) {
      setShowErrors(true);
      setFormError(probs[0]!.text);
      return;
    }
    setSaving(submit ? 'submit' : 'draft');
    setFormError(null);
    try {
      const saved = await saveDraft.mutateAsync({
        state: s,
        saved: dcr?.status === 'draft' ? { id: dcr.id, version: dcr.version } : null,
      });
      setDcr(saved);
      if (!submit) {
        Alert.alert('Draft saved', 'You can come back and finish it later.');
        router.back();
        return;
      }
      submitKey.current ??= idempotencyKey();
      try {
        const submitted = await submitMut.mutateAsync({
          id: saved.id,
          version: saved.version,
          key: submitKey.current,
        });
        setDcr(submitted);
        Alert.alert('Submitted', `Report for ${dateLabel(s.date)} submitted.`);
        router.back();
      } catch (e) {
        if (e instanceof ApiError && e.code === 'DEVIATION_REASON_REQUIRED') {
          setAskDeviation(true);
          setFormError(saveMessage(e));
          submitKey.current = null;
          return;
        }
        if (e instanceof ApiError && e.code === 'DAY_ALREADY_SUBMITTED') {
          const existingId = (e.details as { existingId?: string } | undefined)?.existingId ?? null;
          setDaySubmitted({ id: existingId });
          setFormError(saveMessage(e));
          return;
        }
        setFormError(
          `${saveMessage(e)} Your draft is saved; press Submit again.`,
        );
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DAY_ALREADY_SUBMITTED') {
        const existingId = (e.details as { existingId?: string } | undefined)?.existingId ?? null;
        setDaySubmitted({ id: existingId });
      }
      setFormError(saveMessage(e));
    } finally {
      setSaving(null);
    }
  }

  function confirmDelete() {
    if (!dcr || dcr.status !== 'draft') return;
    Alert.alert(
      'Delete this draft?',
      `The draft for ${dateLabel(dcr.date)} and its calls will be deleted.`,
      [
        { text: 'Keep draft', style: 'cancel' },
        {
          text: 'Delete draft',
          style: 'destructive',
          onPress: () =>
            deleteMut.mutate(dcr.id, {
              onSuccess: () => router.back(),
              onError: (e) => setFormError(saveMessage(e)),
            }),
        },
      ],
    );
  }

  const status =
    !dcr
      ? 'Not started'
      : dcr.status === 'draft'
        ? 'Draft'
        : dcr.status === 'submitted'
          ? 'Submitted'
          : 'Locked';

  const title =
    dcr?.status === 'submitted'
      ? `Submitted · ${dateLabel(s.date)}`
      : dateLocked
        ? `Draft · ${dateLabel(s.date)}`
        : 'New report';

  if ((optionsQ.isPending && !optionsQ.data) || (reportId && recordQ.isPending && !dcr && !optionsQ.data))
    return (
      <View style={[styles.flex, styles.center]}>
        <Stack.Screen options={{ title: 'DCR' }} />
        <ActivityIndicator color={colors.navy} />
      </View>
    );

  if (loadError && !workTypes)
    return (
      <View style={[styles.flex, styles.center]}>
        <Stack.Screen options={{ title: 'DCR' }} />
        <AppText variant="bodyMuted" style={styles.centerText}>
          {loadError}
        </AppText>
        <Button label="Go back" variant="secondary" onPress={() => router.back()} />
      </View>
    );

  const scopes = hqIdsOf(rows, s.territoryIds).map((hqId) => ({
    hqId,
    localIds: s.territoryIds.filter((id) => rows.find((r) => r.id === id)?.hqId === hqId && id !== hqId),
  }));

  return (
    <View style={styles.flex}>
      <Stack.Screen options={{ title }} />
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={spacing.xl}
      >
        <View style={styles.statusRow}>
          <Chip
            label={status}
            tone={status === 'Submitted' ? 'green' : status === 'Draft' ? 'blue' : 'neutral'}
          />
          <AppText variant="small">{dateLabel(s.date)}</AppText>
        </View>

        {daySubmitted && dcr?.status !== 'submitted' ? (
          <View style={styles.warn}>
            <AppText variant="label">
              You already submitted a report for {dateLabel(s.date)}.
            </AppText>
            <AppText variant="bodyMuted">
              Only one report per day can be submitted, so this{' '}
              {dcr ? 'draft' : 'form'} can’t be saved or submitted.
            </AppText>
            {daySubmitted.id ? (
              <Button
                label="View submitted report"
                variant="secondary"
                compact
                onPress={() =>
                  router.replace({
                    pathname: '/dcr/form',
                    params: { id: daySubmitted.id!, date: s.date },
                  })
                }
              />
            ) : null}
            {dcr?.status === 'draft' ? (
              <Button
                label="Delete draft"
                variant="secondary"
                compact
                onPress={confirmDelete}
              />
            ) : null}
          </View>
        ) : null}

        {!dateLocked && !readOnly ? (
          <Field
            label="Date"
            value={dateLabel(s.date)}
            onPress={() => setSheet('date')}
            error={undefined}
          />
        ) : null}

        <Field
          label="Work on"
          value={s.workOn?.label}
          placeholder="Choose what you worked on"
          onPress={readOnly ? undefined : () => setSheet('workOn')}
          error={err('workOn')[0]}
        />

        {field ? (
          <>
            <Field
              label="Band"
              value={
                BANDS.find(
                  (b) =>
                    b.band ===
                    bandOf(
                      (workTypes ?? []).find((w) => w.id === s.workTypeId)?.band,
                    ),
                )?.label
              }
              placeholder="HQ, Ex-HQ or Out-station"
              onPress={readOnly ? undefined : () => setSheet('band')}
              error={err('band')[0]}
            />
            {s.workTypeId ? (
              <Field
                label="Territory"
                value={
                  s.territoryIds.length
                    ? s.territoryIds.map((id) => placeName.get(id) ?? id).join(', ')
                    : undefined
                }
                placeholder="Choose territories"
                onPress={readOnly ? undefined : () => setSheet('territory')}
                error={err('territory')[0]}
              />
            ) : null}
            {s.territoryIds.length ? (
              <>
                <Field
                  label="Work with"
                  value={
                    s.workWithDone
                      ? s.workWith.length
                        ? s.workWith.map((id) => personName.get(id) ?? id).join(', ')
                        : 'Worked alone'
                      : undefined
                  }
                  placeholder="Choose colleagues or Worked alone"
                  onPress={readOnly ? undefined : () => setSheet('workWith')}
                  error={err('workWith')[0]}
                />
                {!readOnly && !s.workWithDone ? (
                  <Button
                    label="Worked alone"
                    variant="secondary"
                    compact
                    onPress={() => update({ workWith: [], workWithDone: true })}
                  />
                ) : null}
              </>
            ) : null}

            {s.workWithDone ? (
              <View style={styles.section}>
                <AppText variant="label">SFC / TA·DA</AppText>
                {s.sfc.state === 'loading' ? (
                  <ActivityIndicator color={colors.navy} />
                ) : s.sfc.state === 'error' ? (
                  <AppText variant="caption" style={styles.err}>
                    SFC could not be loaded. Retry before submitting.
                  </AppText>
                ) : s.sfc.state === 'no_match' ? (
                  <AppText variant="caption" style={styles.err}>
                    No matching SFC record. Change the territory or band.
                  </AppText>
                ) : s.sfc.state === 'ok' ? (
                  s.sfc.hqs.map((h) => {
                    const picked = s.routeChoice[h.hqTerritoryId];
                    const chosen =
                      (picked && h.candidates.some((x) => x.id === picked)
                        ? picked
                        : h.autoSelectedId) ?? '';
                    const c = h.candidates.find((x) => x.id === chosen);
                    return (
                      <View key={h.hqTerritoryId} style={styles.sfcBlock}>
                        {h.candidates.length > 1 && !readOnly ? (
                          <View style={styles.field}>
                            <AppText variant="label">
                              {h.hqName}: which route did you travel?
                            </AppText>
                            <Pressable
                              onPress={() => {
                                setRouteHq(h.hqTerritoryId);
                                setSheet('route');
                              }}
                              style={styles.select}
                            >
                              <AppText
                                variant="body"
                                style={[styles.selectText, !c && styles.ph]}
                              >
                                {c
                                  ? `${c.fromPlace} to ${c.toPlace}`
                                  : 'Choose your route'}
                              </AppText>
                              <Icon name="chevron-down" color={colors.subtle} />
                            </Pressable>
                          </View>
                        ) : null}
                        {c ? (
                          <SfcRouteCard
                            title={`${h.hqName} · ${c.fromPlace} to ${c.toPlace}`}
                            facts={candidateFacts(c)}
                            note="From your SFC. Read-only; changes are made on the SFC screen."
                          />
                        ) : (
                          <AppText variant="bodyMuted">
                            Pick a route to see its TA/DA.
                          </AppText>
                        )}
                      </View>
                    );
                  })
                ) : dcr?.sfcRoutes?.length && readOnly ? (
                  dcr.sfcRoutes.map((r) =>
                    r.snapshot ? (
                      <SfcRouteCard
                        key={r.hqTerritoryId}
                        title={`${r.snapshot.fromPlace} to ${r.snapshot.toPlace}`}
                        facts={{
                          fromPlace: r.snapshot.fromPlace,
                          toPlace: r.snapshot.toPlace,
                          oneWayKm: r.snapshot.oneWayKm,
                          bothWayKm: r.snapshot.bothWayKm,
                          oneWayAmount: r.snapshot.oneWayAmount,
                          bothWayAmount: r.snapshot.bothWayAmount,
                          actualFare: r.snapshot.actualFare,
                          travelMode: r.snapshot.travelMode,
                          category: r.snapshot.category,
                          band: r.snapshot.band,
                          da: r.snapshot.da,
                          source: r.snapshot.source,
                          ratePerKm: r.snapshot.ratePerKm,
                        }}
                        note={`Frozen at submit · TA rate ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(r.snapshot.ratePerKm)}/km`}
                      />
                    ) : null,
                  )
                ) : null}
                {err('sfc').map((m) => (
                  <AppText key={m} variant="caption" style={styles.err}>
                    {m}
                  </AppText>
                ))}
              </View>
            ) : null}

            {s.sfc.state === 'ok' || (readOnly && (dcr?.calls?.length ?? 0) > 0) ? (
              <View style={styles.section}>
                <AppText variant="label">Calls</AppText>
                {err('calls').map((m) => (
                  <AppText key={m} variant="caption" style={styles.err}>
                    {m}
                  </AppText>
                ))}
                {s.calls.map((c, i) => (
                  <CallEditor
                    key={c.clientId}
                    call={c}
                    index={i}
                    readOnly={readOnly}
                    errors={err(`call-${c.clientId}`)}
                    products={productsQ.data ?? []}
                    scopes={scopes}
                    onChange={(p) =>
                      update((x) => ({
                        calls: x.calls.map((row) =>
                          row.clientId === c.clientId ? { ...row, ...p } : row,
                        ),
                      }))
                    }
                    onRemove={() =>
                      update((x) => ({
                        calls: x.calls.filter((row) => row.clientId !== c.clientId),
                      }))
                    }
                  />
                ))}
                {!readOnly ? (
                  <View style={styles.row}>
                    {(['doctor', 'chemist', 'stockist'] as CallKind[]).map((kind) => (
                      <Pressable
                        key={kind}
                        onPress={() =>
                          update((x) => ({
                            calls: [
                              ...x.calls,
                              {
                                clientId: idempotencyKey(),
                                kind,
                                outletId: '',
                                outletName: '',
                                hqId: scopes[0]?.hqId ?? '',
                                time: nowHHmm(),
                                productIds: [],
                                remarks: '',
                              },
                            ],
                          }))
                        }
                        style={styles.addCall}
                      >
                        <Icon name="plus" size={18} color={colors.navy} />
                        <AppText variant="action">{KIND_LABEL[kind]}</AppText>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}

        {s.workOn?.branch === 'meeting' || s.workOn?.branch === 'training' ? (
          <MeetingEditor
            kind={s.workOn.branch}
            value={s.meeting}
            readOnly={readOnly}
            errors={{
              title: err('title'),
              location: err('location'),
              startTime: err('startTime'),
              durationMin: err('durationMin'),
            }}
            onChange={(meeting) => update({ meeting })}
          />
        ) : null}

        {s.workOn?.branch === 'office' ? (
          <OfficeEditor
            value={s.office}
            readOnly={readOnly}
            errors={{
              taskType: err('taskType'),
              description: err('description'),
              durationMin: err('durationMin'),
            }}
            onChange={(office) => update({ office })}
          />
        ) : null}

        {s.workOn?.branch === 'leave' ? (
          <LeaveFields
            date={s.date}
            value={s.leaveRequestId}
            onChange={(leaveRequestId) => update({ leaveRequestId })}
            readOnly={readOnly}
            error={err('leave')[0]}
          />
        ) : null}

        {askDeviation || s.deviationReason ? (
          <TextField
            label="Why does this day differ from your tour plan?"
            value={s.deviationReason}
            onChangeText={(deviationReason) => update({ deviationReason })}
            editable={!readOnly}
            maxLength={500}
            multiline
          />
        ) : null}

        {formError ? (
          <AppText variant="caption" style={styles.err} accessibilityLiveRegion="polite">
            {formError}
          </AppText>
        ) : null}

        {!readOnly && !blocked ? (
          <>
            <Button
              label="Save draft"
              variant="secondary"
              loading={saving === 'draft'}
              loadingLabel="Saving…"
              disabled={busy || !s.workTypeId}
              onPress={() => void save(false)}
            />
            <Button
              label="Submit"
              loading={saving === 'submit'}
              loadingLabel="Submitting…"
              disabled={busy || !s.workTypeId}
              onPress={() => void save(true)}
            />
          </>
        ) : null}
        {dcr?.status === 'draft' && !readOnly ? (
          <Pressable onPress={confirmDelete} style={styles.remove} disabled={busy}>
            <Icon name="trash-can-outline" color={colors.danger} />
            <AppText variant="button" style={styles.err}>
              Delete draft
            </AppText>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>

      <SelectSheet
        visible={sheet === 'workOn'}
        title="Work on"
        options={choices.map((c) => ({ value: c.key, label: c.label }))}
        value={s.workOn?.key ?? null}
        onPick={(v) => v && chooseWorkOn(v)}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'band'}
        title="Band"
        options={(s.workOn?.workTypes ?? []).map((w) => {
          const b = BANDS.find((x) => x.band === bandOf(w.band));
          return { value: w.id, label: b?.label ?? w.name, hint: b?.hint };
        })}
        value={s.workTypeId || null}
        onPick={(v) => v && chooseBand(v)}
        onClose={() => setSheet(null)}
      />
      <MultiSelectSheet
        visible={sheet === 'territory'}
        title="Territories"
        options={rows.map((r) => ({
          value: r.id,
          label: `${r.name} (${r.code})`,
          hint: r.level === 'headquarter' ? 'HQ' : r.hqName,
        }))}
        values={s.territoryIds}
        onDone={chooseTerritories}
        onClose={() => setSheet(null)}
      />
      <MultiSelectSheet
        visible={sheet === 'workWith'}
        title="Work with"
        options={(peopleQry.data ?? []).map((p) => ({
          value: p.id,
          label: p.name,
          hint: [p.employeeCode, p.designation].filter(Boolean).join(' · '),
        }))}
        values={s.workWith}
        onDone={(ids) => update({ workWith: ids, workWithDone: true })}
        onClose={() => setSheet(null)}
      />
      <SelectSheet
        visible={sheet === 'route' && !!routeHq}
        title="SFC route"
        options={
          (s.sfc.hqs.find((h) => h.hqTerritoryId === routeHq)?.candidates ?? []).map(
            (c) => ({
              value: c.id,
              label: `${c.fromPlace} to ${c.toPlace}`,
              hint: `${c.oneWayKm} km`,
            }),
          )
        }
        value={routeHq ? (s.routeChoice[routeHq] ?? null) : null}
        onPick={(v) => {
          if (routeHq && v)
            update((x) => ({ routeChoice: { ...x.routeChoice, [routeHq]: v } }));
        }}
        onClose={() => {
          setSheet(null);
          setRouteHq(null);
        }}
      />
      <SelectSheet
        visible={sheet === 'date'}
        title="Date"
        options={[{ value: today, label: dateLabel(today), hint: 'Today' }]}
        value={s.date}
        onPick={(v) => {
          if (v && v !== s.date) {
            setS(fresh(v));
            setDcr(null);
            setDaySubmitted(null);
          }
        }}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

function Field({
  label,
  value,
  placeholder,
  onPress,
  error,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  onPress?: () => void;
  error?: string;
}) {
  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={[styles.select, !!error && styles.selectErr]}
        accessibilityRole="button"
      >
        <AppText
          variant="body"
          numberOfLines={2}
          style={[styles.selectText, !value && styles.ph]}
        >
          {value || placeholder || '—'}
        </AppText>
        {onPress ? <Icon name="chevron-down" color={colors.subtle} /> : null}
      </Pressable>
      {error ? (
        <AppText variant="caption" style={styles.err}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

function CallEditor({
  call,
  index,
  readOnly,
  errors,
  products,
  scopes,
  onChange,
  onRemove,
}: {
  call: CallDraft;
  index: number;
  readOnly: boolean;
  errors: string[];
  products: { id: string; label: string }[];
  scopes: { hqId: string; localIds: string[] }[];
  onChange: (p: Partial<CallDraft>) => void;
  onRemove: () => void;
}) {
  const [pickOutlet, setPickOutlet] = useState(false);
  const [outlets, setOutlets] = useState<{ value: string; label: string; hint?: string; hqId?: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pickOutlet) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const path =
          call.kind === 'doctor'
            ? '/v1/doctors'
            : call.kind === 'chemist'
              ? '/v1/chemists'
              : '/v1/stockists';
        const queries =
          call.kind === 'stockist'
            ? scopes.map((sc) => ({ territoryId: sc.hqId, limit: 100, sort: 'name' as const }))
            : scopes.flatMap((sc) =>
                sc.localIds.length
                  ? sc.localIds.map((localTerritoryId) => ({
                      territoryId: sc.hqId,
                      localTerritoryId,
                      limit: 100,
                      sort: 'name' as const,
                    }))
                  : [
                      {
                        territoryId: sc.hqId,
                        limit: 100,
                        sort: 'name' as const,
                      },
                    ],
              );
        const pages = await Promise.all(
          queries.map((query) =>
            apiFetch<{
              items: {
                id: string;
                name: string;
                city?: string | null;
                territoryId?: string | null;
                approvalStatus?: string;
              }[];
            }>(path, { query }),
          ),
        );
        if (!live) return;
        const seen = new Set<string>();
        const out: typeof outlets = [];
        for (const page of pages)
          for (const x of page.items) {
            if (seen.has(x.id)) continue;
            if (call.kind === 'doctor' && x.approvalStatus === 'rejected') continue;
            seen.add(x.id);
            out.push({
              value: x.id,
              label: x.name,
              hint: x.city ?? undefined,
              hqId: x.territoryId ?? scopes[0]?.hqId,
            });
          }
        setOutlets(out);
      } catch {
        if (live) setOutlets([]);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [pickOutlet, call.kind, scopes]);

  return (
    <View style={styles.call}>
      <View style={styles.callHead}>
        <AppText variant="body">
          {KIND_LABEL[call.kind]} #{index + 1}
        </AppText>
        {!readOnly ? (
          <Pressable onPress={onRemove} accessibilityLabel="Remove call">
            <Icon name="trash-can-outline" color={colors.danger} size={20} />
          </Pressable>
        ) : null}
      </View>
      <Field
        label={KIND_LABEL[call.kind]}
        value={call.outletName || undefined}
        placeholder={`Choose ${KIND_LABEL[call.kind].toLowerCase()}`}
        onPress={readOnly ? undefined : () => setPickOutlet(true)}
        error={errors[0]}
      />
      <TimeField
        label="Visit time"
        value={call.time}
        onChange={(time) => onChange({ time })}
        editable={!readOnly}
        error={errors.find((e) => e.toLowerCase().includes('time'))}
      />
      {call.kind === 'doctor' ? (
        <AppText variant="small">
          Products:{' '}
          {call.productIds.length
            ? call.productIds
                .map((id) => products.find((p) => p.id === id)?.label ?? id)
                .join(', ')
            : 'None'}
        </AppText>
      ) : null}
      <TextField
        label="Remarks"
        value={call.remarks}
        onChangeText={(remarks) => onChange({ remarks })}
        editable={!readOnly}
        maxLength={1000}
      />
      <SelectSheet
        visible={pickOutlet}
        title={KIND_LABEL[call.kind]}
        options={
          loading
            ? [{ value: '', label: 'Loading…' }]
            : outlets
        }
        value={call.outletId || null}
        onPick={(v) => {
          if (!v) return;
          const o = outlets.find((x) => x.value === v);
          onChange({
            outletId: v,
            outletName: o?.label ?? v,
            hqId: o?.hqId ?? call.hqId,
          });
        }}
        onClose={() => setPickOutlet(false)}
      />
    </View>
  );
}

function MeetingEditor({
  kind,
  value,
  readOnly,
  errors,
  onChange,
}: {
  kind: 'meeting' | 'training';
  value: FlowState['meeting'];
  readOnly: boolean;
  errors: Record<string, string[]>;
  onChange: (v: FlowState['meeting']) => void;
}) {
  const [pick, setPick] = useState(false);
  const presets = kind === 'meeting' ? MEETING_TYPES : TRAINING_TYPES;
  return (
    <View style={styles.section}>
      <AppText variant="label">{kind === 'meeting' ? 'Meeting' : 'Training'}</AppText>
      <Field
        label="Type"
        value={value.title || undefined}
        placeholder="Choose type"
        onPress={readOnly ? undefined : () => setPick(true)}
        error={errors.title?.[0]}
      />
      <Field
        label="Mode"
        value={value.mode === 'online' ? 'Online' : 'In person'}
        onPress={
          readOnly
            ? undefined
            : () =>
                onChange({
                  ...value,
                  mode: value.mode === 'online' ? 'in_person' : 'online',
                })
        }
      />
      <TextField
        label={value.mode === 'online' ? 'Link or platform' : 'Location'}
        value={value.location}
        onChangeText={(location) => onChange({ ...value, location })}
        editable={!readOnly}
        error={errors.location?.[0]}
        maxLength={200}
      />
      <TimeField
        label="Start time"
        value={value.startTime}
        onChange={(startTime) => onChange({ ...value, startTime })}
        editable={!readOnly}
        error={errors.startTime?.[0]}
      />
      <TextField
        label="Duration (minutes)"
        value={value.durationMin}
        onChangeText={(durationMin) =>
          onChange({ ...value, durationMin: durationMin.replace(/\D/g, '').slice(0, 3) })
        }
        editable={!readOnly}
        keyboardType="number-pad"
        error={errors.durationMin?.[0]}
      />
      {kind === 'training' ? (
        <TextField
          label="Trainer"
          value={value.trainer}
          onChangeText={(trainer) => onChange({ ...value, trainer })}
          editable={!readOnly}
          maxLength={120}
        />
      ) : (
        <TextField
          label="Attendees"
          value={value.attendees}
          onChangeText={(attendees) => onChange({ ...value, attendees })}
          editable={!readOnly}
          maxLength={500}
        />
      )}
      <TextField
        label="Remarks"
        value={value.remarks}
        onChangeText={(remarks) => onChange({ ...value, remarks })}
        editable={!readOnly}
        maxLength={1000}
      />
      <SelectSheet
        visible={pick}
        title="Type"
        options={[
          ...presets.map((p) => ({ value: p, label: p })),
          { value: '__other', label: 'Other…' },
        ]}
        value={presets.includes(value.title) ? value.title : value.title ? '__other' : null}
        onPick={(v) => {
          if (v === '__other') onChange({ ...value, title: '' });
          else if (v) onChange({ ...value, title: v });
        }}
        onClose={() => setPick(false)}
      />
    </View>
  );
}

function OfficeEditor({
  value,
  readOnly,
  errors,
  onChange,
}: {
  value: FlowState['office'];
  readOnly: boolean;
  errors: Record<string, string[]>;
  onChange: (v: FlowState['office']) => void;
}) {
  const [pick, setPick] = useState(false);
  return (
    <View style={styles.section}>
      <AppText variant="label">Admin work</AppText>
      <Field
        label="Task type"
        value={value.taskType || undefined}
        placeholder="Choose task type"
        onPress={readOnly ? undefined : () => setPick(true)}
        error={errors.taskType?.[0]}
      />
      <TextField
        label="What you did"
        value={value.description}
        onChangeText={(description) => onChange({ ...value, description })}
        editable={!readOnly}
        multiline
        error={errors.description?.[0]}
        maxLength={1000}
      />
      <TimeField
        label="Start time"
        value={value.startTime}
        onChange={(startTime) => onChange({ ...value, startTime })}
        editable={!readOnly}
        optional
      />
      <TextField
        label="Duration (minutes)"
        value={value.durationMin}
        onChangeText={(durationMin) =>
          onChange({ ...value, durationMin: durationMin.replace(/\D/g, '').slice(0, 3) })
        }
        editable={!readOnly}
        keyboardType="number-pad"
        error={errors.durationMin?.[0]}
      />
      <TextField
        label="Remarks"
        value={value.remarks}
        onChangeText={(remarks) => onChange({ ...value, remarks })}
        editable={!readOnly}
        maxLength={1000}
      />
      <SelectSheet
        visible={pick}
        title="Task type"
        options={ADMIN_TASKS.map((p) => ({ value: p, label: p }))}
        value={value.taskType || null}
        onPick={(v) => v && onChange({ ...value, taskType: v })}
        onClose={() => setPick(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  center: { alignItems: 'center', justifyContent: 'center', padding: layout.gutter, gap: spacing.lg },
  centerText: { textAlign: 'center' },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  warn: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.warnWash,
  },
  field: { gap: spacing.sm },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.control,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  selectErr: { borderColor: colors.danger },
  selectText: { flex: 1, fontFamily: fonts.regular, fontSize: type.body.fontSize },
  ph: { color: colors.subtle },
  err: { color: colors.danger },
  section: { gap: spacing.md },
  sfcBlock: { gap: spacing.md },
  call: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
  },
  callHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addCall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touch.control,
  },
});
