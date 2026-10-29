import type { Dcr } from '@ariforce/contracts';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { CallEditor } from '@/components/dcr/call-editor';
import { dcrStyles, Errors, Field } from '@/components/dcr/field';
import { LeaveFields } from '@/components/dcr/leave-fields';
import { MeetingEditor } from '@/components/dcr/meeting-editor';
import { MultiSelectSheet } from '@/components/dcr/multi-select-sheet';
import { OfficeEditor } from '@/components/dcr/office-editor';
import { SfcSection } from '@/components/dcr/sfc-section';
import { useBottomSpace } from '@/components/floating-tab-bar';
import { Icon } from '@/components/icon';
import { SelectSheet } from '@/components/masters/select-sheet';
import { KeyboardAwareScrollView } from '@/components/scroll';
import { TextField } from '@/components/text-field';
import { SkeletonForm } from '@/components/skeleton';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  fetchSfcMatch,
  idempotencyKey,
  useDeleteDraft,
  useDcrRecord,
  useDcrOptions,
  useDcrTerritories,
  useSaveDraft,
  useSubmitDcr,
  useWorkWith,
} from '@/lib/dcr/api';
import {
  REVIEW_LABEL,
  REVIEW_TONE,
  isDayLocked,
  reviewOf,
  sendsCalledAt,
  submitRuleError,
  useDcrProducts,
  useDecisions,
  useMyUnlockRequests,
  usePresentationLog,
  useRequestUnlock,
} from '@/lib/dcr/adapter';
import { dateLabel, nowHHmm, todayIST } from '@/lib/dcr/dates';
import { saveMessage } from '@/lib/dcr/errors';
import { bandOf } from '@/lib/dcr/bands';
import {
  BANDS,
  KIND_LABEL,
  SAVED_CUSTOMER,
  callsFromDcr,
  sendableCall,
  timeOfIso,
  cleanSfcHqs,
  emptyMeeting,
  emptyOffice,
  hqIdsOf,
  normaliseWorkTypes,
  problems as findProblems,
  territoryRows,
  workOnChoices,
  workOnFor,
  type CallKind,
  type FlowState,
  type WorkTypeOption,
} from '@/lib/dcr/model';
import { isSalesRole } from '@/lib/roles';
import { colors, layout, radius, spacing, touch } from '@/theme';

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
  const {
    id,
    date: dateParam,
    new: isNew,
  } = useLocalSearchParams<{
    id?: string;
    date?: string;
    new?: string;
  }>();
  const { user } = useAuth();
  const today = todayIST();
  // DCR is for the sales ladder only (web nav.ts SALES).
  if (!isSalesRole(user?.roles ?? [])) return <Redirect href="/" />;
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
  const peopleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Work With search goes to the server (web dcr-flow.tsx), debounced like the website's pickers.
  const searchPeople = (q: string) => {
    if (peopleTimer.current) clearTimeout(peopleTimer.current);
    peopleTimer.current = setTimeout(() => setPeopleQ(q.trim()), 300);
  };
  useEffect(
    () => () => {
      if (peopleTimer.current) clearTimeout(peopleTimer.current);
    },
    [],
  );
  /** Date + report this form was filled from; refetches after a save never refill it. */
  const hydratedFor = useRef<string | null>(null);
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
  const productsQ = useDcrProducts(optionsQ.data, !!field);
  const saveDraft = useSaveDraft();
  const submitMut = useSubmitDcr();
  const deleteMut = useDeleteDraft();
  const presLog = usePresentationLog(s.date);
  const decisionsQ = useDecisions();
  const decisions = decisionsQ.data ?? {};
  const review = dcr ? reviewOf(dcr, decisions) : null;
  const locked = isDayLocked(dcr, s.date) && dcr?.status !== 'submitted';
  const v2Unlock = optionsQ.data && 'unlockRequest' in optionsQ.data;
  // Old API only: best-effort match of my pending dcr_unlock approvals.
  const myUnlocksQ = useMyUnlockRequests(locked && !v2Unlock);
  const unlockMut = useRequestUnlock();
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const unlockPending = v2Unlock
    ? optionsQ.data?.unlockRequest?.status === 'pending'
    : (myUnlocksQ.data ?? []).some(
        (a) => a.summary.includes(s.date) || (dcr && a.subjectId === dcr.id),
      );
  /** Calls the server refused on submit (422 PRESENTATION_NOT_OPENED / POB_NOT_ALLOWED_FOR_DOCTOR). */
  const [flagged, setFlagged] = useState<Record<string, string>>({});

  const choices = useMemo(() => workOnChoices(workTypes ?? []), [workTypes]);
  const rows = useMemo(() => territoryRows(terrQ.data ?? []), [terrQ.data]);
  const placeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.id, r.name);
    return m;
  }, [rows]);
  // Remember every person seen, so picked names survive a new search.
  const personName = useMemo(() => {
    for (const p of peopleQry.data ?? []) names.current.set(p.id, p.name);
    return new Map(names.current);
  }, [peopleQry.data]);

  // A rejected report never blocks filing the day again (adapter: mock until the contract lands).
  const daySub = optionsQ.data?.submitted ?? null;
  const subRejected = !!daySub && reviewOf(daySub, decisions).status === 'rejected';
  const blocked = !!daySubmitted && dcr?.status !== 'submitted' && !subRejected;
  const readOnly =
    dcr?.status === 'submitted' || locked || blocked || review?.status === 'rejected';
  const busy = !!saving || saveDraft.isPending || submitMut.isPending || deleteMut.isPending;

  // Hydrate from options + optional record
  useEffect(() => {
    if (!optionsQ.data) {
      if (optionsQ.isError) setLoadError(saveMessage(optionsQ.error));
      return;
    }
    // Fill the form once per date/report. Saving invalidates the DCR queries; without this guard
    // the refetch reset the form and dropped the saved draft (the next save made a second draft).
    const hydrateKey = `${optionsQ.data.date}|${reportId ?? ''}`;
    if (hydratedFor.current === hydrateKey) return;
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
    hydratedFor.current = hydrateKey;
    if (sub && sub.id !== d?.id) setDaySubmitted({ id: sub.id });
    setDcr(d);
    const next = fresh(optionsQ.data.date);
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
  }, [
    optionsQ.data,
    optionsQ.isError,
    optionsQ.error,
    optionsQ.isPending,
    recordQ.data,
    recordQ.isError,
    recordQ.isPending,
    reportId,
  ]);

  // Resolve saved customer names, whenever a call still shows the placeholder.
  const missingNames = s.calls
    .filter((c) => c.outletId && (!c.outletName || c.outletName === SAVED_CUSTOMER))
    .map((c) => `${c.kind}:${c.outletId}`)
    .join(',');
  useEffect(() => {
    if (!missingNames) return;
    const missing = missingNames.split(',').map((k) => {
      const [kind, outletId] = k.split(':') as [CallKind, string];
      return { kind, outletId };
    });
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
  }, [missingNames]);

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
          bandOf(r.band) ?? bandOf((workTypes ?? []).find((w) => w.id === workTypeId)?.band);
        const hqs = cleanSfcHqs(r.hqs, band);
        const empty = hqs.filter((h) => !h.candidates.length);
        if (empty.length) return setS((x) => ({ ...x, sfc: { state: 'no_match', hqs: [] } }));
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
      if (wo.branch !== 'field') return { workOn: wo, workTypeId: wo.workTypes[0]!.id };
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
          c.hqId && !hq.has(c.hqId) ? { ...c, outletId: '', outletName: '', hqId: '' } : c,
        ),
      };
    });

  // Presentation flags live in the adapter (mock store until DcrCall.presentationOpenedAt lands).
  const sEff: FlowState = {
    ...s,
    calls: s.calls.map((c) =>
      c.kind === 'doctor' &&
      !c.presentationOpened &&
      c.outletId &&
      presLog.opened.includes(c.outletId)
        ? { ...c, presentationOpened: true }
        : c,
    ),
  };
  const probs = findProblems(sEff);
  const err = (key: string) =>
    showErrors ? probs.filter((p) => p.key === key).map((p) => p.text) : [];

  async function save(submit: boolean) {
    if (readOnly) return;
    if (submit && probs.length) {
      setShowErrors(true);
      setFormError((probs.find((p) => p.key === 'presentation') ?? probs[0]!).text);
      return;
    }
    setSaving(submit ? 'submit' : 'draft');
    setFormError(null);
    try {
      const saved = await saveDraft.mutateAsync({
        state: sEff,
        saved: dcr?.status === 'draft' ? { id: dcr.id, version: dcr.version } : null,
      });
      setDcr(saved);
      // Show the server's calledAt (new API stamps it on first save; the app never sends it).
      if (!sendsCalledAt()) {
        const at = new Map(saved.calls.map((c) => [c.id, timeOfIso(c.calledAt)]));
        setS((x) => ({
          ...x,
          calls: x.calls.map((c) => (at.has(c.clientId) ? { ...c, time: at.get(c.clientId)! } : c)),
        }));
      }
      setFlagged({});
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
        // Same as web dcr-flow.tsx: keep the key only when no answer came back (the submit may
        // have gone through, and a retry with the same key is safe); any API answer drops it.
        if (!(e instanceof ApiError && e.code === 'NETWORK')) submitKey.current = null;
        const rule = submitRuleError(
          e,
          sEff.calls.filter(sendableCall).map((c) => c.clientId),
        );
        if (rule) {
          setFlagged(Object.fromEntries(rule.clientIds.map((id) => [id, rule.callText])));
          setShowErrors(true);
          const which = sEff.calls
            .map((c, i) => (rule.clientIds.includes(c.clientId) ? `call ${i + 1}` : null))
            .filter(Boolean)
            .join(', ');
          setFormError(`${rule.message}${which ? ` (${which})` : ''}`);
          return;
        }
        if (e instanceof ApiError && e.code === 'DEVIATION_REASON_REQUIRED') {
          setAskDeviation(true);
          setFormError(saveMessage(e));
          return;
        }
        if (e instanceof ApiError && e.code === 'DAY_ALREADY_SUBMITTED') {
          const existingId = (e.details as { existingId?: string } | undefined)?.existingId ?? null;
          setDaySubmitted({ id: existingId });
          setFormError(saveMessage(e));
          return;
        }
        setFormError(`${saveMessage(e)} Your draft is saved; press Submit again.`);
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

  const status = locked ? 'Locked' : review ? REVIEW_LABEL[review.status] : 'Not started';
  const statusTone = locked ? 'neutral' : review ? REVIEW_TONE[review.status] : 'neutral';

  async function requestUnlock() {
    const reason = unlockReason.trim();
    if (reason.length < 3) {
      setUnlockError('Say why the day needs to be reopened (at least 3 characters).');
      return;
    }
    setUnlockError(null);
    try {
      await unlockMut.mutateAsync({ date: s.date, reason });
      setUnlockReason('');
      Alert.alert(
        'Unlock requested',
        'Your manager will review it. You can edit once it is approved.',
      );
    } catch (e) {
      setUnlockError(saveMessage(e));
    }
  }

  const title =
    dcr?.status === 'submitted'
      ? `Submitted · ${dateLabel(s.date)}`
      : dateLocked
        ? `Draft · ${dateLabel(s.date)}`
        : 'New report';

  if (
    (optionsQ.isPending && !optionsQ.data) ||
    (reportId && recordQ.isPending && !dcr && !optionsQ.data)
  )
    return (
      <View style={[styles.flex, styles.content]}>
        <Stack.Screen options={{ title: 'DCR' }} />
        <SkeletonForm count={4} />
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
    localIds: s.territoryIds.filter(
      (id) => rows.find((r) => r.id === id)?.hqId === hqId && id !== hqId,
    ),
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
          <Chip label={status} tone={statusTone} />
          <AppText variant="small">{dateLabel(s.date)}</AppText>
        </View>

        {review?.status === 'rejected' ? (
          <View style={styles.warn}>
            <AppText variant="label">Rejected by your manager</AppText>
            <AppText variant="bodyMuted">{review.reason || 'No reason given.'}</AppText>
            <AppText variant="small">
              This report doesn’t count. The day is open again for 48 hours: file it as a new
              report.
            </AppText>
            <Button
              label="File this day again"
              variant="secondary"
              compact
              onPress={() =>
                // A brand-new form: new call clientIds and a new idempotency key, never the old ones.
                router.replace({ pathname: '/dcr/form', params: { new: '1', date: s.date } })
              }
            />
          </View>
        ) : null}

        {locked ? (
          <View style={styles.warn}>
            <AppText variant="label">This day is locked</AppText>
            <AppText variant="bodyMuted">
              Reports lock at 12:01 AM after their day. Ask your manager to reopen it to edit or
              submit.
            </AppText>
            {unlockPending || unlockMut.isSuccess ? (
              <Chip label="Unlock requested · waiting for your manager" tone="orange" />
            ) : (
              <>
                <TextField
                  label="Reason (required)"
                  value={unlockReason}
                  onChangeText={setUnlockReason}
                  maxLength={500}
                  multiline
                  error={unlockError}
                />
                <Button
                  label="Request unlock"
                  variant="secondary"
                  compact
                  loading={unlockMut.isPending}
                  loadingLabel="Requesting…"
                  onPress={() => void requestUnlock()}
                />
              </>
            )}
          </View>
        ) : null}

        {blocked ? (
          <View style={styles.warn}>
            <AppText variant="label">
              You already submitted a report for {dateLabel(s.date)}.
            </AppText>
            <AppText variant="bodyMuted">
              Only one report per day can be submitted, so this {dcr ? 'draft' : 'form'} can’t be
              saved or submitted.
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
              <Button label="Delete draft" variant="secondary" compact onPress={confirmDelete} />
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
                    b.band === bandOf((workTypes ?? []).find((w) => w.id === s.workTypeId)?.band),
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
              <SfcSection
                sfc={s.sfc}
                routeChoice={s.routeChoice}
                readOnly={readOnly}
                dcr={dcr}
                errors={err('sfc')}
                onChooseRoute={(hq) => {
                  setRouteHq(hq);
                  setSheet('route');
                }}
              />
            ) : null}

            {s.sfc.state === 'ok' || (readOnly && (dcr?.calls?.length ?? 0) > 0) ? (
              <View style={dcrStyles.section}>
                <AppText variant="label">Calls</AppText>
                <Errors list={err('calls')} />
                {s.calls.map((c, i) => (
                  <CallEditor
                    key={c.clientId}
                    call={sEff.calls[i] ?? c}
                    index={i}
                    readOnly={readOnly}
                    errors={[
                      ...err(`call-${c.clientId}`),
                      ...(flagged[c.clientId] ? [flagged[c.clientId]!] : []),
                    ]}
                    products={productsQ.data ?? []}
                    onPresented={() => {
                      if (c.outletId) presLog.record(c.outletId);
                      update((x) => ({
                        calls: x.calls.map((row) =>
                          row.clientId === c.clientId ? { ...row, presentationOpened: true } : row,
                        ),
                      }));
                    }}
                    scopes={scopes}
                    names={placeName}
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
                                // New API: calledAt is stamped by the server on first save.
                                time: sendsCalledAt() ? nowHHmm() : '',
                                productIds: [],
                                pob: [],
                                presentationOpened: false,
                                remarks: '',
                              },
                            ],
                          }))
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${KIND_LABEL[kind].toLowerCase()} call`}
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
          <AppText variant="caption" style={dcrStyles.err} accessibilityLiveRegion="polite">
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
          <Pressable
            onPress={confirmDelete}
            style={styles.remove}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Delete draft"
          >
            <Icon name="trash-can-outline" color={colors.danger} />
            <AppText variant="button" style={dcrStyles.err}>
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
        onClose={() => {
          setSheet(null);
          searchPeople('');
        }}
        onSearch={searchPeople}
        loading={peopleQry.isFetching}
      />
      <SelectSheet
        visible={sheet === 'route' && !!routeHq}
        title="SFC route"
        options={(s.sfc.hqs.find((h) => h.hqTerritoryId === routeHq)?.candidates ?? []).map(
          (c) => ({
            value: c.id,
            label: `${c.fromPlace} to ${c.toPlace}`,
            hint: `${c.oneWayKm} km`,
          }),
        )}
        value={routeHq ? (s.routeChoice[routeHq] ?? null) : null}
        onPick={(v) => {
          if (routeHq && v) update((x) => ({ routeChoice: { ...x.routeChoice, [routeHq]: v } }));
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
            hydratedFor.current = null;
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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: layout.gutter,
    gap: spacing.lg,
  },
  centerText: { textAlign: 'center' },
  content: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, gap: spacing.lg },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  warn: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.warnWash,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addCall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touch.min,
    paddingHorizontal: spacing.md,
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
