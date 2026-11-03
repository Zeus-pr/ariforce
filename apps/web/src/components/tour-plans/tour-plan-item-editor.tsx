'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DcrDetails } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { toast } from '@ariforce/ui/components/sonner';
import { api, apiReady, toApiError } from '@/lib/api';
import {
  BANDS,
  cleanSfcHqs,
  detailsOf,
  emptyMeeting,
  emptyOffice,
  normaliseWorkTypes,
  territoryRows,
  workOnChoices,
  workOnFor,
  type FlowState,
  type HqOption,
  type Person,
  type WorkTypeOption,
} from '@/lib/dcr/model';
import { bandOf } from '@/lib/dcr/bands';
import { thrownMessage } from '@/lib/dcr/errors';
import { tpFutureMonthCutoffError } from '@/lib/tour-plans/cutoff';
import { ChoiceSelect } from '@/components/dcr/choice-select';
import { MeetingFields, OfficeFields, SfcPanel } from '@/components/dcr/dcr-sections';
import { SearchSelect, type SelectOption } from '@/components/dcr/search-select';
import { saveTourPlanItem, submitTourPlanItem, type TpItem } from '@/lib/tour-plans/items';

type Props = {
  date: string | null;
  item: TpItem | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const isDetails = (value: unknown): value is DcrDetails =>
  typeof value === 'object' && value !== null && 'kind' in value;
const emptySfc = (): FlowState['sfc'] => ({ state: 'idle', hqs: [] });
const emptyFlow = (date: string): FlowState => ({
  date,
  workOn: undefined,
  workTypeId: '',
  territoryIds: [],
  workWith: [],
  workWithDone: false,
  sfc: emptySfc(),
  routeChoice: {},
  calls: [],
  meeting: emptyMeeting(),
  office: emptyOffice(),
  leaveRequestId: '',
  deviationReason: '',
});
const itemDetails = (item: TpItem | null): DcrDetails | null =>
  isDetails(item?.plan.details) ? item.plan.details : null;

function flowFromItem(date: string, item: TpItem | null): FlowState {
  const state = emptyFlow(date);
  if (!item) return state;
  const details = itemDetails(item);
  state.workTypeId = item.plan.workTypeId;
  state.territoryIds = item.plan.territoryIds;
  state.workWith = item.plan.workWithUserIds;
  state.workWithDone = true;
  state.routeChoice = Object.fromEntries(
    item.plan.sfcRoutes.map((route) => [route.hqTerritoryId, route.sfcRouteId]),
  );
  if (details?.kind === 'meeting' || details?.kind === 'training') {
    state.meeting = {
      title: details.title,
      mode: details.mode,
      location: details.location ?? '',
      startTime: details.startTime,
      durationMin: String(details.durationMin),
      attendees: details.attendees ?? '',
      remarks: details.remarks ?? '',
      trainer: details.kind === 'training' ? (details.trainer ?? '') : '',
    };
  }
  if (details?.kind === 'office') {
    state.office = {
      taskType: details.taskType,
      description: details.description,
      startTime: details.startTime ?? '',
      durationMin: String(details.durationMin),
      remarks: details.remarks ?? '',
    };
  }
  return state;
}

export function TourPlanItemEditor({ date, item, readOnly = false, onClose, onSaved }: Props) {
  const [from, setFrom] = useState(date ?? '');
  const [to, setTo] = useState(date ?? '');
  const [state, setState] = useState<FlowState>(() => emptyFlow(date ?? ''));
  const [workingItem, setWorkingItem] = useState<TpItem | null>(item);
  const [workTypes, setWorkTypes] = useState<WorkTypeOption[]>([]);
  const [workTypesError, setWorkTypesError] = useState<string | null>(null);
  const [workTypesLoading, setWorkTypesLoading] = useState(false);
  const [workTypesTick, setWorkTypesTick] = useState(0);
  const [hqs, setHqs] = useState<HqOption[]>([]);
  const [hqsError, setHqsError] = useState<string | null>(null);
  const [hqsLoading, setHqsLoading] = useState(false);
  const [hqsTick, setHqsTick] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleTick, setPeopleTick] = useState(0);
  const [personNames, setPersonNames] = useState<Map<string, string>>(new Map());
  const [sfcTick, setSfcTick] = useState(0);
  const [missingHqIds, setMissingHqIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const dateWindowClosed = !!(date && tpFutureMonthCutoffError((item?.from ?? date).slice(0, 7)));
  const mutable =
    !readOnly &&
    !dateWindowClosed &&
    (!item || item.status === 'draft' || item.status === 'rejected');

  useEffect(() => {
    if (!date) return;
    setFrom(item?.from ?? date);
    setTo(item?.to ?? date);
    setState(flowFromItem(item?.from ?? date, item));
    setWorkingItem(item);
    setError(null);
    setShowErrors(false);
  }, [date, item]);

  useEffect(() => {
    if (!date || !from) return;
    let live = true;
    setWorkTypesError(null);
    setWorkTypesLoading(true);
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/dcrs/options', { params: { query: { date: from } } });
      if (!live) return;
      if (!r.data) throw new Error(toApiError(r).message || 'Could not load work types.');
      const normalized = normaliseWorkTypes(r.data.workTypes as WorkTypeOption[]);
      setWorkTypes(normalized);
      setWorkTypesLoading(false);
      setState((current) => ({
        ...current,
        workOn: workOnFor(workOnChoices(normalized), current.workTypeId),
      }));
    })().catch((cause: unknown) => {
      if (!live) return;
      setWorkTypesError(thrownMessage(cause));
      setWorkTypesLoading(false);
    });
    return () => {
      live = false;
    };
  }, [date, from, workTypesTick]);

  useEffect(() => {
    if (!date || !state.workOn || state.workOn.branch !== 'field') return;
    let live = true;
    setHqsError(null);
    setHqsLoading(true);
    void apiReady()
      .then(() => api.GET('/v1/dcrs/territories', {}))
      .then((r) => {
        if (!live) return;
        if (!r.data) throw new Error(toApiError(r).message || 'Could not load your territories.');
        setHqs(r.data.items as HqOption[]);
        setHqsLoading(false);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setHqsError(thrownMessage(cause));
        setHqsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [date, state.workOn?.branch, hqsTick]);

  useEffect(() => {
    if (!date || !state.workOn || state.workOn.branch !== 'field' || !state.territoryIds.length)
      return;
    let live = true;
    setPeopleError(null);
    setPeopleLoading(true);
    void apiReady()
      .then(() =>
        api.GET('/v1/dcrs/work-with', {
          params: { query: { limit: 100, ...(peopleQuery ? { q: peopleQuery } : {}) } },
        }),
      )
      .then((r) => {
        if (!live) return;
        if (!r.data) throw new Error(toApiError(r).message || 'Could not load Work With people.');
        setPeople(r.data.items as Person[]);
        setPersonNames(
          (old) =>
            new Map([
              ...old,
              ...r.data!.items.map((person) => [person.id, person.name] as [string, string]),
            ]),
        );
        setPeopleLoading(false);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setPeopleError(thrownMessage(cause));
        setPeopleLoading(false);
      });
    return () => {
      live = false;
    };
  }, [date, state.workOn?.branch, state.territoryIds.length, peopleQuery, peopleTick]);

  const rows = useMemo(() => territoryRows(hqs), [hqs]);
  const choices = useMemo(
    () =>
      workOnChoices(workTypes).filter(
        (choice) =>
          choice.branch !== 'leave' &&
          !choice.workTypes.some(
            (workType) => workType.kind === 'leave' || workType.kind === 'holiday',
          ),
      ),
    [workTypes],
  );
  const chosenWorkType = workTypes.find((workType) => workType.id === state.workTypeId);
  const field = state.workOn?.branch === 'field';
  const sfcKey =
    field && state.workTypeId && state.territoryIds.length && state.workWithDone
      ? `${from}|${state.workTypeId}|${state.territoryIds.join(',')}|${state.workWith.join(',')}|${sfcTick}`
      : '';

  useEffect(() => {
    if (!sfcKey) return;
    let live = true;
    const [sfcDate, workTypeId, territoryIds] = sfcKey.split('|') as [string, string, string];
    setState((current) => ({ ...current, sfc: { state: 'loading', hqs: [] } }));
    setMissingHqIds([]);
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/dcrs/sfc-match', {
        params: { query: { date: sfcDate, workTypeId, territoryIds } },
      });
      if (!live) return;
      if (r.data) {
        const band = bandOf(r.data.band) ?? chosenWorkType?.band ?? null;
        const matching = cleanSfcHqs(r.data.hqs, band);
        const missing = matching
          .filter((hq) => !hq.candidates.length)
          .map((hq) => hq.hqTerritoryId);
        if (missing.length) {
          setMissingHqIds(missing);
          setState((current) => ({ ...current, sfc: { state: 'no_match', hqs: [] } }));
          return;
        }
        setState((current) => ({ ...current, sfc: { state: 'ok', hqs: matching } }));
        return;
      }
      const apiError = toApiError(r);
      if (apiError.code === 'SFC_NO_MATCH') {
        const details = apiError.details as { missingHqIds?: string[] } | undefined;
        setMissingHqIds(details?.missingHqIds ?? []);
        setState((current) => ({ ...current, sfc: { state: 'no_match', hqs: [] } }));
        return;
      }
      throw new Error(apiError.message || 'Could not load matching SFC routes.');
    })().catch(() => {
      if (live) setState((current) => ({ ...current, sfc: { state: 'error', hqs: [] } }));
    });
    return () => {
      live = false;
    };
  }, [sfcKey, chosenWorkType?.band]);

  const missingNames = missingHqIds.map((id) => rows.find((row) => row.id === id)?.name ?? id);
  const selectedDetails = detailsOf(state);
  const detailErrors = useMemo(() => {
    const errors: Record<string, string[]> = {};
    if (showErrors && !selectedDetails) {
      if (state.workOn?.branch === 'meeting' || state.workOn?.branch === 'training') {
        if (!state.meeting.title.trim())
          errors.title = [
            state.workOn.branch === 'meeting'
              ? 'Choose the meeting type.'
              : 'Choose or enter a type.',
          ];
        if (state.meeting.mode === 'in_person' && !state.meeting.location.trim())
          errors.location = ['Enter the location.'];
        if (!/^[0-2]\d:[0-5]\d$/.test(state.meeting.startTime))
          errors.startTime = ['Enter a valid start time.'];
        const duration = Number(state.meeting.durationMin);
        if (!Number.isInteger(duration) || duration < 1 || duration > 720)
          errors.durationMin = ['Enter 1 to 720 minutes.'];
      }
      if (state.workOn?.branch === 'office') {
        if (!state.office.taskType.trim()) errors.taskType = ['Choose or enter a task type.'];
        if (!state.office.description.trim()) errors.description = ['Describe the task.'];
        const duration = Number(state.office.durationMin);
        if (!Number.isInteger(duration) || duration < 1 || duration > 720)
          errors.durationMin = ['Enter 1 to 720 minutes.'];
      }
    }
    return errors;
  }, [selectedDetails, showErrors, state.meeting, state.office, state.workOn?.branch]);

  const pickWorkOn = (key: string) => {
    const choice = choices.find((entry) => entry.key === key);
    const workTypeId = choice?.workTypes[0]?.id ?? '';
    setState((current) => ({
      ...emptyFlow(from),
      workTypeId,
      workOn: choice,
      meeting: current.meeting,
      office: current.office,
    }));
  };
  const pickBand = (band: string) => {
    const workType = workTypes.find(
      (candidate) => candidate.kind === 'field' && candidate.band === band,
    );
    if (!workType) return;
    setState((current) => ({
      ...current,
      workTypeId: workType.id,
      sfc: emptySfc(),
      routeChoice: {},
    }));
  };
  const setField = (patch: Partial<FlowState>) => setState((current) => ({ ...current, ...patch }));
  const routeChoice = (hqId: string, routeId: string) =>
    setState((current) => ({
      ...current,
      routeChoice: { ...current.routeChoice, [hqId]: routeId },
    }));
  const routeFor = (hq: FlowState['sfc']['hqs'][number]) => {
    const picked = state.routeChoice[hq.hqTerritoryId];
    return (
      (picked && hq.candidates.some((candidate) => candidate.id === picked) ? picked : null) ??
      hq.autoSelectedId
    );
  };

  const validate = () => {
    setShowErrors(true);
    if (!from || !to || to < from) {
      setError('Choose a valid date range.');
      return false;
    }
    const cutoffError = tpFutureMonthCutoffError(from.slice(0, 7));
    if (cutoffError) {
      setError(cutoffError);
      return false;
    }
    const numberOfDays =
      Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) +
      1;
    if (numberOfDays > 31) {
      setError('A tour plan can cover at most 31 days.');
      return false;
    }
    if (!state.workTypeId || !state.workOn) {
      setError('Choose what you plan to work on.');
      return false;
    }
    if (field) {
      if (!state.territoryIds.length) {
        setError('Choose at least one territory.');
        return false;
      }
      if (!state.workWithDone) {
        setError('Finish choosing Work With people, or confirm you will work alone.');
        return false;
      }
      if (state.sfc.state !== 'ok') {
        setError('Matching SFC routes must load before saving.');
        return false;
      }
      if (state.sfc.hqs.some((hq) => !routeFor(hq))) {
        setError('Choose an SFC route for each headquarter.');
        return false;
      }
    } else if (
      state.workOn.branch === 'meeting' ||
      state.workOn.branch === 'training' ||
      state.workOn.branch === 'office'
    ) {
      if (!selectedDetails) {
        setError('Complete the work details before saving.');
        return false;
      }
    } else if (state.workOn.branch === 'other') {
      if (state.workOn.workTypes[0]?.detailsKind) {
        setError('This work type does not have a supported tour-plan details form.');
        return false;
      }
    }
    setError(null);
    return true;
  };

  const save = async (submit: boolean) => {
    if (!validate()) return;
    setLoading(true);
    setError(null);
    let savedItem: TpItem | null = null;
    try {
      const routes = field
        ? state.sfc.hqs
            .map((hq) => ({
              hqTerritoryId: hq.hqTerritoryId,
              sfcRouteId: routeFor(hq) ?? '',
            }))
            .filter((route) => route.sfcRouteId)
        : [];
      const existingItem = workingItem ?? item;
      savedItem = await saveTourPlanItem({
        ...(existingItem ? { id: existingItem.id, version: existingItem.version } : {}),
        from,
        to,
        plan: {
          workTypeId: state.workTypeId,
          territoryIds: field ? state.territoryIds : [],
          workWithUserIds: field ? state.workWith : [],
          sfcRoutes: routes,
          details: field ? null : selectedDetails,
        },
      });
      setWorkingItem(savedItem);
      onSaved();
      if (submit) await submitTourPlanItem(savedItem.id);
      toast.success(submit ? 'Tour plan submitted for approval.' : 'Tour plan draft saved.');
      onClose();
    } catch (cause) {
      setError(
        submit && savedItem
          ? `Draft saved, but it could not be submitted: ${thrownMessage(cause)}`
          : thrownMessage(cause),
      );
    } finally {
      setLoading(false);
    }
  };

  const workOnOptions: SelectOption[] = choices.map((choice) => ({
    id: choice.key,
    label: choice.label,
  }));
  const territoryOptions: SelectOption[] = rows.map((row) => ({
    id: row.id,
    label: row.name,
    hint: row.level === 'territory' ? row.hqName : 'Headquarter',
    group: row.hqName,
    indent: row.level === 'territory',
  }));
  const personOptions: SelectOption[] = people.map((person) => ({
    id: person.id,
    label: person.name,
    hint: [person.employeeCode, person.designation].filter(Boolean).join(' · ') || null,
  }));
  const routeFactsState = state.sfc;
  const editable = mutable && !loading;
  const savingDisabled = loading || !!workTypesError || workTypesLoading || hqsLoading;

  return (
    <Dialog open={!!date} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90dvh] max-w-3xl overflow-y-auto"
        data-testid="tp-item-editor"
      >
        <DialogHeader>
          <DialogTitle>
            {item
              ? `${item.status === 'rejected' ? 'Update rejected tour plan' : 'Tour plan'} · ${item.from}`
              : 'Plan a tour'}
          </DialogTitle>
          <DialogDescription>
            Choose the same work, territory, joint-work and route details as a DCR. Customer calls
            are not part of a tour plan.
          </DialogDescription>
        </DialogHeader>
        {!mutable && item && (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm" role="status">
            {dateWindowClosed
              ? 'The planning window for this tour plan is closed.'
              : item.status === 'approved'
                ? 'Approved tour plans are read-only.'
                : 'This tour plan has been submitted and is read-only.'}
          </p>
        )}
        {item?.status === 'rejected' && item.rejectionReason && (
          <p className="rounded-lg border border-destructive/30 bg-danger-soft p-3 text-sm text-destructive">
            <span className="font-medium">Returned for changes:</span> {item.rejectionReason}
          </p>
        )}
        <div className="flex flex-col gap-5">
          <section className="grid gap-3 sm:grid-cols-2" aria-label="Tour plan dates">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tp-item-from">From</Label>
              <Input
                id="tp-item-from"
                type="date"
                value={from}
                disabled={!editable}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setState((current) => ({
                    ...current,
                    date: event.target.value,
                    sfc: emptySfc(),
                  }));
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tp-item-to">To</Label>
              <Input
                id="tp-item-to"
                type="date"
                min={from}
                value={to}
                disabled={!editable}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </section>

          {workTypesError ? (
            <div
              className="flex items-center justify-between gap-3 text-sm text-destructive"
              role="alert"
            >
              <span>{workTypesError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setWorkTypesTick((tick) => tick + 1)}
              >
                Retry
              </Button>
            </div>
          ) : (
            <section className="flex flex-col gap-3" aria-label="Work type">
              {workTypesLoading && (
                <p className="text-sm text-muted-foreground" aria-busy="true">
                  Loading work types…
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <Label>Work on</Label>
                <ChoiceSelect
                  value={state.workOn?.key ?? ''}
                  onValueChange={pickWorkOn}
                  choices={workOnOptions.map((option) => ({
                    value: option.id,
                    label: option.label,
                  }))}
                  placeholder="Choose work type"
                  disabled={!editable}
                  testId="tp-item-work-on"
                />
              </div>
              {!choices.length && (
                <p className="text-sm text-muted-foreground">
                  No eligible work types are configured.
                </p>
              )}
              {field && (
                <div className="flex flex-col gap-1.5">
                  <Label>Band</Label>
                  <ChoiceSelect
                    value={chosenWorkType?.band ?? ''}
                    onValueChange={pickBand}
                    choices={BANDS.filter((band) =>
                      workTypes.some(
                        (workType) => workType.kind === 'field' && workType.band === band.band,
                      ),
                    ).map((band) => ({ value: band.band, label: band.label, hint: band.hint }))}
                    placeholder="Choose HQ, EX or OS"
                    disabled={!editable}
                    testId="tp-item-band"
                  />
                </div>
              )}
            </section>
          )}

          {field && (
            <>
              {hqsError ? (
                <div
                  className="flex items-center justify-between gap-3 text-sm text-destructive"
                  role="alert"
                >
                  <span>{hqsError}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setHqsTick((tick) => tick + 1)}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <SearchSelect
                  label="Territories"
                  options={territoryOptions}
                  value={state.territoryIds}
                  onChange={(ids) =>
                    setField({
                      territoryIds: ids,
                      workWith: [],
                      workWithDone: false,
                      sfc: emptySfc(),
                      routeChoice: {},
                    })
                  }
                  multiple
                  placeholder="Choose one or more"
                  loading={hqsLoading}
                  disabled={!editable}
                  testId="tp-item-territories"
                  emptyText="No territories are assigned to you."
                />
              )}
              {state.territoryIds.length > 0 && (
                <SearchSelect
                  label="Work With"
                  options={personOptions}
                  value={state.workWith}
                  onChange={(ids) =>
                    setField({ workWith: ids, workWithDone: false, sfc: emptySfc() })
                  }
                  multiple
                  placeholder="Choose people or leave empty to work alone"
                  loading={peopleLoading}
                  error={peopleError}
                  onRetry={() => setPeopleTick((tick) => tick + 1)}
                  onQuery={setPeopleQuery}
                  onDone={() => setField({ workWithDone: true, sfc: emptySfc() })}
                  labels={personNames}
                  disabled={!editable}
                  testId="tp-item-work-with"
                  doneLabel="Done"
                />
              )}
              {state.workWithDone &&
                (editable ||
                  routeFactsState.state === 'ok' ||
                  routeFactsState.state === 'loading') &&
                (routeFactsState.state === 'loading' && !editable ? (
                  <p className="text-sm text-muted-foreground" aria-busy="true">
                    Loading saved SFC route details…
                  </p>
                ) : (
                  <SfcPanel
                    state={routeFactsState.state}
                    hqs={routeFactsState.hqs}
                    choice={state.routeChoice}
                    onChoose={routeChoice}
                    onRetry={() => setSfcTick((tick) => tick + 1)}
                    onChangeTerritory={() =>
                      setField({
                        territoryIds: [],
                        workWith: [],
                        workWithDone: false,
                        sfc: emptySfc(),
                      })
                    }
                    missingHqNames={missingNames}
                    readOnly={!editable}
                  />
                ))}
              {state.workWithDone &&
                !editable &&
                routeFactsState.state !== 'ok' &&
                routeFactsState.state !== 'loading' && (
                  <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                    Saved SFC route facts are not available from the current route data.
                  </p>
                )}
            </>
          )}

          {!field && state.workOn?.branch === 'meeting' && (
            <MeetingFields
              kind="meeting"
              value={state.meeting}
              onChange={(meeting) => setField({ meeting })}
              readOnly={!editable}
              errors={detailErrors}
            />
          )}
          {!field && state.workOn?.branch === 'training' && (
            <MeetingFields
              kind="training"
              value={state.meeting}
              onChange={(meeting) => setField({ meeting })}
              readOnly={!editable}
              errors={detailErrors}
            />
          )}
          {!field && state.workOn?.branch === 'office' && (
            <OfficeFields
              value={state.office}
              onChange={(office) => setField({ office })}
              readOnly={!editable}
              errors={detailErrors}
            />
          )}
          {!field && state.workOn?.branch === 'other' && (
            <p className="rounded-lg border bg-muted/40 p-3 text-sm">
              {chosenWorkType?.name ?? 'This work type'} does not require additional details.
            </p>
          )}
          {field && state.workWithDone && (
            <p className="text-sm text-muted-foreground">
              {state.workWith.length
                ? `Working with: ${state.workWith
                    .map(
                      (id) =>
                        personNames.get(id) ??
                        people.find((person) => person.id === id)?.name ??
                        'Saved team member',
                    )
                    .join(', ')}`
                : 'Working alone'}
            </p>
          )}
          {!field && item?.plan.workWithUserIds.length ? (
            <p className="text-sm">
              <span className="font-medium">Work With:</span>{' '}
              {item.plan.workWithUserIds
                .map(
                  (id) =>
                    personNames.get(id) ??
                    people.find((person) => person.id === id)?.name ??
                    'Saved team member',
                )
                .join(', ')}
            </p>
          ) : null}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          {mutable ? (
            <>
              <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void save(false)}
                disabled={savingDisabled}
              >
                {loading ? 'Saving…' : 'Save draft'}
              </Button>
              <Button type="button" onClick={() => void save(true)} disabled={savingDisabled}>
                {loading ? 'Submitting…' : 'Submit for approval'}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
