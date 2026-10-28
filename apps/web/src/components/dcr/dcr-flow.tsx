'use client';

import { CheckCircle2, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import type { Dcr } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Input } from '@ariforce/ui/components/input';
import { Label } from '@ariforce/ui/components/label';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { dateLabel, todayIST } from '@/components/attendance/format';
import Link from 'next/link';
import { api, apiReady, MOCKING, toApiError, type ApiError } from '@/lib/api';
import {
  BANDS,
  KIND_LABEL,
  callsFromDcr,
  dcrErrorMessage,
  draftBody,
  emptyMeeting,
  emptyOffice,
  hqIdsOf,
  problems as findProblems,
  territoryRows,
  workOnChoices,
  workOnFor,
  type CallDraft,
  type CallKind,
  type FlowState,
  type HqOption,
  type Person,
  type SfcHq,
  type WorkTypeOption,
  SAVED_CUSTOMER,
  normaliseWorkTypes,
  cleanSfcHqs,
} from '@/lib/dcr/model';
import { failureMessage, thrownMessage } from '@/lib/dcr/errors';
import { bandOf } from '@/lib/dcr/bands';
import { ChoiceSelect } from './choice-select';
import { CallCard, type CustomerScope, FieldError, LeaveFields, MeetingFields, OfficeFields, SfcPanel } from './dcr-sections';
import { SearchSelect, type SelectOption } from './search-select';

const noop = () => () => {};
const nowHHmm = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const istDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const timeLabel = (iso: string) => `${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso))} IST`;

/** DCR redesign: one scrollable page, sections appear as the previous choice is made. */

const WORK_ON_HINT: Record<string, string> = {
  field: 'Doctor, chemist and stockist visits',
  meeting: 'Cycle meetings, reviews, conferences',
  training: 'Product or skills training',
  office: 'Admin work at the office or home',
  leave: 'Full or half day off',
};
/** What the drafts workspace can ask of an open report (collapse safely, autosave). */
export type FlowController = {
  /** Unsaved edits on the page. */
  isDirty: () => boolean;
  /** A draft can be saved now (a work type is chosen and the report is still editable). */
  canSave: () => boolean;
  /** Save as draft without submitting; true when it saved. */
  saveDraft: () => Promise<boolean>;
};

export type FlowProps = {
  /** Date to open (default today). */
  initialDate?: string;
  /** An existing draft is opened for its own date: the date can't be changed here. */
  dateLocked?: boolean;
  /** After a successful save (draft) or submit. */
  onSaved?: (dcr: Dcr, submitted: boolean) => void;
  /** The draft (or submitted report) to open; omit for a new draft. */
  reportId?: string | null;
  /** Ask to delete the open draft (the workspace confirms and calls DELETE). */
  onDelete?: (dcr: Dcr) => void;
  /** Open another report of yours, e.g. the day's submitted one. */
  onOpenReport?: (id: string, date: string) => void;
  /** The date already has a submitted report (from options or a 409 DAY_ALREADY_SUBMITTED). */
  onDaySubmitted?: (date: string, existingId: string | null) => void;
  controller?: Ref<FlowController>;
};

export function DcrFlow(props: FlowProps) {
  const today = useSyncExternalStore(noop, todayIST, () => null);
  if (!today) return <div className="h-[560px]" aria-busy="true" />;
  return <Flow today={today} {...props} />;
}

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

function Step({ title, hint, children, testId, id }: { title: string; hint?: string; children: React.ReactNode; testId: string; id?: string }) {
  return (
    <section id={id} className="af-enter flex scroll-mt-20 flex-col gap-3 border-t pt-6 first:border-t-0 first:pt-0" data-testid={testId} aria-labelledby={`${testId}-h`}>
      <div className="flex flex-col gap-0.5">
        <h2 id={`${testId}-h`} className="text-base font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Flow({ today, initialDate, dateLocked = false, reportId, onSaved, onDelete, onOpenReport, onDaySubmitted, controller }: FlowProps & { today: string }) {
  const [s, setS] = useState<FlowState>(() => fresh(initialDate ?? today));
  const [workTypes, setWorkTypes] = useState<WorkTypeOption[] | null>(null);
  const [dcr, setDcr] = useState<Dcr | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hqs, setHqs] = useState<HqOption[] | null>(null);
  const [hqError, setHqError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleQ, setPeopleQ] = useState('');
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [products, setProducts] = useState<SelectOption[]>([]);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productsTick, setProductsTick] = useState(0);
  const [askDeviation, setAskDeviation] = useState(false);
  /** The server copy moved on (other tab, submitted, locked): offer a reload instead of more failed saves. */
  const [stale, setStale] = useState(false);
  /** The API has no /v1/dcrs/options yet (older deploy): point to the classic DCR screen. */
  const [apiMissing, setApiMissing] = useState(false);
  const [missingHqIds, setMissingHqIds] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [reload, setReload] = useState(0);
  const [sfcTick, setSfcTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  /** The draft this form edits: the one opened, or the one created by the first save. */
  const idRef = useRef<string | null>(reportId ?? null);
  const [gone, setGone] = useState(false);
  /** The day's submitted report when it is not the one open (drafts of that day are delete-only). */
  const [daySubmitted, setDaySubmitted] = useState<{ id: string | null } | null>(null);
  const onDaySubmittedRef = useRef(onDaySubmitted);
  useEffect(() => {
    onDaySubmittedRef.current = onDaySubmitted;
  });
  const submitKey = useRef<string | null>(null);
  const names = useRef(new Map<string, string>());
  const lastFieldWt = useRef('');
  const [personNames, setPersonNames] = useState<Map<string, string>>(new Map());
  const [peopleTick, setPeopleTick] = useState(0);

  const choices = useMemo(() => workOnChoices(workTypes ?? []), [workTypes]);
  const rows = useMemo(() => territoryRows(hqs ?? []), [hqs]);
  const hqNames = useMemo(() => new Map((hqs ?? []).map((h) => [h.id, h.name])), [hqs]);
  const branch = s.workOn?.branch;
  const field = branch === 'field';
  const blocked = !!daySubmitted && dcr?.status !== 'submitted';
  const readOnly = dcr?.status === 'submitted' || dcr?.status === 'locked' || blocked || gone;
  const dayHqIds = useMemo(() => hqIdsOf(rows, s.territoryIds), [rows, s.territoryIds]);
  // Per HQ of the day: the picked level-'territory' rows under it, or none when the HQ itself was picked (whole HQ).
  const customerScope = useMemo<CustomerScope[]>(
    () =>
      dayHqIds.map((hqId) => ({
        hqId,
        localIds: s.territoryIds.includes(hqId) ? [] : rows.filter((r) => r.level === 'territory' && r.hqId === hqId && s.territoryIds.includes(r.id)).map((r) => r.id),
      })),
    [dayHqIds, rows, s.territoryIds],
  );
  const placeNames = useMemo(() => new Map(rows.map((r) => [r.id, r.name])), [rows]);
  const update = (patch: Partial<FlowState> | ((x: FlowState) => Partial<FlowState>)) => {
    setDirty(true);
    setS((x) => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) }));
  };

  // Date -> options (work types + your DCR for the date). Changing the date resets every dependent choice.
  useEffect(() => {
    let live = true;
    setWorkTypes(null);
    setLoadError(null);
    setShowErrors(false);
    setStale(false);
    setGone(false);
    setDaySubmitted(null);
    submitKey.current = null;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/dcrs/options', { params: { query: { date: s.date } } });
      if (!live) return;
      if (!r.data) {
        // An API without the redesign answers GET /v1/dcrs/options as GET /v1/dcrs/{id}: 404.
        if (r.response?.status === 404) setApiMissing(true);
        return setLoadError(failureMessage(r, 'Could not load the report for this date.'));
      }
      setApiMissing(false);
      // Several drafts per day: open the one asked for; a new form starts empty.
      const want = idRef.current;
      const sub = r.data.submitted ?? null;
      let d: Dcr | null = null;
      if (want) {
        d = (r.data.drafts ?? []).find((x) => x.id === want) ?? (sub?.id === want ? sub : null);
        if (!d) {
          const g = await api.GET('/v1/dcrs/{id}', { params: { path: { id: want } } });
          if (!live) return;
          if (g.data && g.data.date === s.date) d = g.data;
          else if (g.data || g.response?.status === 404) {
            setGone(true);
            return setLoadError('This draft no longer exists. It may have been deleted on another device.');
          } else return setLoadError(failureMessage(g, 'Could not load this report.'));
        }
      }
      if (sub && sub.id !== d?.id) {
        setDaySubmitted({ id: sub.id });
        onDaySubmittedRef.current?.(s.date, sub.id);
      }
      const wts = normaliseWorkTypes(r.data.workTypes as WorkTypeOption[]);
      setWorkTypes(wts);
      setDcr(d);
      setDirty(false);
      const next = fresh(s.date);
      if (d) {
        const wo = workOnFor(workOnChoices(wts), d.workTypeId);
        next.workOn = wo;
        next.workTypeId = d.workTypeId;
        next.territoryIds = d.territoryIds;
        next.workWith = d.workWithUserIds;
        next.workWithDone = wo?.branch === 'field' && d.territoryIds.length > 0;
        next.routeChoice = Object.fromEntries(d.sfcRoutes.map((x) => [x.hqTerritoryId, x.sfcRouteId]));
        next.calls = callsFromDcr(d, names.current);
        const det = d.details;
        if (det?.kind === 'meeting' || det?.kind === 'training')
          next.meeting = { title: det.title, mode: det.mode, location: det.location ?? '', startTime: det.startTime, durationMin: String(det.durationMin), attendees: det.kind === 'meeting' ? det.attendees ?? '' : '', remarks: det.remarks ?? '', trainer: det.kind === 'training' ? det.trainer ?? '' : '' };
        if (det?.kind === 'office') next.office = { taskType: det.taskType, description: det.description, startTime: det.startTime ?? '', durationMin: String(det.durationMin), remarks: det.remarks ?? '' };
        if (det?.kind === 'leave') next.leaveRequestId = det.leaveRequestId;
        next.deviationReason = d.deviationReason ?? '';
        setAskDeviation(!!d.deviationReason);
      } else setAskDeviation(false);
      setS(next);
    })().catch((e: unknown) => live && setLoadError(thrownMessage(e)));
    return () => {
      live = false;
    };
  }, [s.date, reload]);

  // Territories in scope (HQs with their level 'territory' rows), once a field band is chosen.
  const loadHqs = useCallback(() => {
    setHqError(null);
    setHqs(null);
    void apiReady()
      .then(() => api.GET('/v1/dcrs/territories', {}))
      .then((r) => (r.data ? setHqs(r.data.items) : setHqError(failureMessage(r, 'Could not load your territories.'))))
      .catch((e: unknown) => setHqError(thrownMessage(e)));
  }, []);
  useEffect(() => {
    if (field && hqs === null && !hqError) loadHqs();
  }, [field, hqs, hqError, loadHqs]);

  // Work With people (server search).
  useEffect(() => {
    if (!field || !s.territoryIds.length) return;
    let live = true;
    setPeopleError(null);
    void apiReady()
      .then(() => api.GET('/v1/dcrs/work-with', { params: { query: { limit: 50, ...(peopleQ ? { q: peopleQ } : {}) } } }))
      .then((r) => {
        if (!live) return;
        if (!r.data) return setPeopleError(failureMessage(r, 'Could not load people.'));
        const items = r.data.items;
        setPersonNames((m) => new Map([...m, ...items.map((p) => [p.id, p.name] as [string, string])]));
        setPeople(items);
      })
      .catch((e: unknown) => live && setPeopleError(thrownMessage(e)));
    return () => {
      live = false;
    };
  }, [field, s.territoryIds.length, peopleQ, peopleTick]);

  // Products for detailing. Mock: Arighna's real product names (loaded lazily, never in the real bundle path).
  useEffect(() => {
    if (!field) return;
    let live = true;
    setProductsError(null);
    void (async () => {
      if (MOCKING) {
        const { MOCK_PRODUCT_SEED } = await import('@/mocks/product-seed');
        if (live) setProducts(MOCK_PRODUCT_SEED.map((p) => ({ id: p.id, label: p.name, hint: p.composition })));
        return;
      }
      const r = await api.GET('/v1/products', { params: { query: { limit: 200 } } });
      if (!live) return;
      if (!r.data) return setProductsError(failureMessage(r, 'Could not load products.'));
      setProducts(r.data.items.filter((p) => p.active).map((p) => ({ id: p.id, label: p.name, hint: p.composition })));
    })().catch((e: unknown) => live && setProductsError(thrownMessage(e)));
    return () => {
      live = false;
    };
  }, [field, productsTick]);

  // Saved calls name their customer by id only: look the names up once per DCR (doctors in one batch).
  useEffect(() => {
    const missing = s.calls.filter((c) => c.outletId && (!c.outletName || c.outletName === SAVED_CUSTOMER));
    if (!missing.length) return;
    let live = true;
    void (async () => {
      await apiReady();
      const found = new Map<string, string>();
      const doctorIds = [...new Set(missing.filter((c) => c.kind === 'doctor').map((c) => c.outletId))].slice(0, 100);
      const jobs: Promise<void>[] = [];
      if (doctorIds.length)
        jobs.push(
          api.GET('/v1/doctors', { params: { query: { ids: doctorIds.join(','), limit: 100 } } }).then((r) => {
            r.data?.items.forEach((d) => found.set(d.id, d.name));
          }),
        );
      for (const c of missing.filter((x) => x.kind !== 'doctor')) {
        const path = c.kind === 'chemist' ? '/v1/chemists/{id}' : '/v1/stockists/{id}';
        jobs.push(
          api.GET(path, { params: { path: { id: c.outletId } } }).then((r) => {
            if (r.data) found.set(r.data.id, r.data.name);
          }),
        );
      }
      await Promise.allSettled(jobs);
      if (!live || !found.size) return;
      found.forEach((n, id) => names.current.set(id, n));
      setS((x) => ({ ...x, calls: x.calls.map((c) => (found.has(c.outletId) ? { ...c, outletName: found.get(c.outletId)! } : c)) }));
    })().catch(() => {
      /* names stay "Saved customer"; the call itself is intact */
    });
    return () => {
      live = false;
    };
    // Once per loaded DCR (its id and version), not on every edit.
  }, [dcr?.id, dcr?.version]);

  // SFC match: after Work With; refreshed whenever date, band, territory or Work With change.
  const sfcKey = field && s.workTypeId && s.territoryIds.length && s.workWithDone && !readOnly ? `${s.date}|${s.workTypeId}|${s.territoryIds.join(',')}|${s.workWith.join(',')}|${sfcTick}` : '';
  useEffect(() => {
    if (!sfcKey) return;
    let live = true;
    const [date, workTypeId, territoryIds] = sfcKey.split('|') as [string, string, string];
    setS((x) => ({ ...x, sfc: { state: 'loading', hqs: [] } }));
    setMissingHqIds([]);
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/dcrs/sfc-match', { params: { query: { date, workTypeId, territoryIds } } });
      if (!live) return;
      if (r.data) {
        const band = bandOf(r.data.band) ?? wtBand(workTypeId);
        const hqs = cleanSfcHqs(r.data.hqs, band);
        // Every candidate of an HQ was legacy/combined: same as no SFC route for that HQ.
        const empty = hqs.filter((h) => !h.candidates.length).map((h) => h.hqTerritoryId);
        if (empty.length) {
          setMissingHqIds(empty);
          return setS((x) => ({ ...x, sfc: { state: 'no_match', hqs: [] } }));
        }
        return setS((x) => ({ ...x, sfc: { state: 'ok', hqs } }));
      }
      const e = toApiError(r);
      if (e.code === 'SFC_NO_MATCH') {
        const det = e.details as { hqs?: SfcHq[]; missingHqIds?: string[] } | undefined;
        setMissingHqIds(det?.missingHqIds ?? []);
        return setS((x) => ({ ...x, sfc: { state: 'no_match', hqs: [] } }));
      }
      setS((x) => ({ ...x, sfc: { state: 'error', hqs: [] } }));
    })().catch(() => live && setS((x) => ({ ...x, sfc: { state: 'error', hqs: [] } })));
    // A slow or dropped SFC lookup ends in the error state with Retry (lib/api times out after 8s).
    return () => {
      live = false;
    };
  }, [sfcKey]);

  const probs = findProblems(s);
  function wtBand(id: string) {
    return bandOf((workTypes ?? []).find((w) => w.id === id)?.band);
  }
  const errorsFor = (key: string) => (showErrors ? probs.filter((p) => p.key === key).map((p) => p.text) : []);
  const errorsByField = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, errorsFor(k)]));

  // ---- choices with their reset rules ----
  const chooseWorkOn = (key: string) => {
    const wo = choices.find((c) => c.key === key);
    if (!wo) return;
    // Field values stay on the page (hidden) when you look at another branch; they are never sent with it.
    update((x) => {
      if (x.workOn?.branch === 'field') lastFieldWt.current = x.workTypeId;
      if (wo.branch !== 'field') return { workOn: wo, workTypeId: wo.workTypes[0]!.id };
      return { workOn: wo, workTypeId: x.workOn?.branch === 'field' ? x.workTypeId : lastFieldWt.current };
    });
  };
  const chooseBand = (workTypeId: string) =>
    update((x) => (x.workTypeId === workTypeId ? {} : { workTypeId, territoryIds: [], workWith: [], workWithDone: false, sfc: { state: 'idle', hqs: [] }, routeChoice: {} }));
  const chooseTerritories = (ids: string[]) =>
    update((x) => {
      const hq = new Set(hqIdsOf(rows, ids));
      return {
        territoryIds: ids,
        workWith: [],
        workWithDone: false,
        sfc: { state: 'idle', hqs: [] },
        routeChoice: {},
        calls: x.calls.map((c) => (c.hqId && !hq.has(c.hqId) ? { ...c, outletId: '', outletName: '', hqId: '' } : c)),
      };
    });
  const addCall = (kind: CallKind) =>
    update((x) => ({ calls: [...x.calls, { clientId: crypto.randomUUID(), kind, outletId: '', outletName: '', hqId: '', time: nowHHmm(), productIds: [], remarks: '' }] }));
  const patchCall = (id: string, p: Partial<CallDraft>) => {
    if (p.outletId && p.outletName) names.current.set(p.outletId, p.outletName);
    update((x) => ({ calls: x.calls.map((c) => (c.clientId === id ? { ...c, ...p } : c)) }));
  };

  async function save(submit: boolean): Promise<boolean> {
    if (submit && probs.length) {
      setShowErrors(true);
      const first = document.querySelector('[role=alert]');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    setSaving(submit ? 'submit' : 'draft');
    try {
      const r = await api.PUT('/v1/dcrs/draft', {
        body: draftBody(s, dcr?.status === 'draft' ? { id: dcr.id, version: dcr.version } : null),
      });
      if (!r.data) {
        failed(toApiError(r), r.response?.status);
        return false;
      }
      let saved = r.data;
      idRef.current = saved.id;
      setDcr(saved);
      if (submit) {
        // One key per submit attempt: a retry after a dropped response returns the same submitted DCR.
        submitKey.current ??= crypto.randomUUID();
        let sub;
        try {
          sub = await api.POST('/v1/dcrs/{id}/submit', {
            params: { path: { id: saved.id }, header: { 'idempotency-key': submitKey.current } },
            body: { version: saved.version },
          });
        } catch (e) {
          // Keep the key: the submit may have gone through; retrying with it is safe.
          toast.error(`${thrownMessage(e)} Your draft is saved; press Submit again.`, { duration: 10000 });
          return false;
        }
        if (!sub.data) {
          submitKey.current = null;
          failed(toApiError(sub), sub.response?.status);
          return false;
        }
        saved = sub.data;
      }
      setDcr(saved);
      setDirty(false);
      setShowErrors(false);
      toast.success(submit ? `Report for ${dateLabel(s.date)} submitted` : 'Draft saved. You can come back and finish it later.');
      onSaved?.(saved, submit);
      return true;
    } catch (e) {
      toast.error(`${thrownMessage(e)} Nothing was saved.`, { duration: 10000 });
      return false;
    } finally {
      setSaving(null);
    }
  }

  useImperativeHandle(controller, () => ({
    isDirty: () => dirty,
    canSave: () => !!s.workTypeId && !readOnly && !saving,
    saveDraft: () => save(false),
  }));

  /** Server said no: plain words, and open the field that fixes it where there is one. */
  function failed(e: ApiError, status?: number) {
    if (e.code === 'DEVIATION_REASON_REQUIRED') {
      setAskDeviation(true);
      setTimeout(() => document.getElementById('dcr-deviation')?.focus(), 50);
    }
    if (e.code === 'VERSION_CONFLICT' || e.code === 'ALREADY_SUBMITTED' || e.code === 'DAY_LOCKED') setStale(true);
    if (e.code === 'DAY_ALREADY_SUBMITTED') {
      const existingId = (e.details as { existingId?: string | null } | undefined)?.existingId ?? null;
      setDaySubmitted({ id: existingId });
      onDaySubmitted?.(s.date, existingId);
    }
    if (status === 404 || e.code === 'NOT_FOUND') {
      setGone(true);
      return void toast.error(dcrErrorMessage({ ...e, code: 'NOT_FOUND' }), { duration: 10000 });
    }
    const msg = e.code === 'NETWORK' && status && status >= 500 ? `The server had a problem (HTTP ${status}). Your changes are still on this page; try again.` : dcrErrorMessage(e);
    const field = (e.details as { field?: string } | undefined)?.field;
    toast.error(e.code === 'VALIDATION' && field ? `${msg} (${field})` : msg, { duration: 10000 });
  }

  const status = !dcr ? 'Not started' : dcr.status === 'draft' ? 'Draft' : dcr.status === 'submitted' ? 'Submitted' : 'Locked';
  const territoryOptions: SelectOption[] = rows.map((r) => ({
    id: r.id,
    label: r.level === 'headquarter' ? `${r.name} (whole HQ)` : `${r.name} · ${r.hqName}`,
    hint: r.level === 'territory' ? r.code : 'Every territory of this HQ',
    group: r.hqName,
    badge: r.level === 'headquarter' ? 'HQ' : null,
    indent: r.level === 'territory',
  }));
  const peopleOptions: SelectOption[] = (people ?? []).map((p) => ({ id: p.id, label: p.name, hint: [p.designation, p.employeeCode].filter(Boolean).join(' · ') || null }));
  const showSfc = field && s.workTypeId && s.territoryIds.length > 0 && s.workWithDone;
  const callsOpen = field && s.sfc.state === 'ok';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-muted-foreground" data-testid="dcr-date-label">{dateLabel(s.date)}</p>
          <p className="text-sm" data-testid="dcr-status">
            <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium', status === 'Submitted' ? 'bg-success-soft text-success' : status === 'Draft' ? 'bg-info-soft text-info' : 'bg-muted text-muted-foreground')}>{status}</span>
            {dcr?.status === 'draft' && <span className="ml-2 text-xs text-muted-foreground">saved {timeLabel(dcr.updatedAt)}</span>}
          </p>
        </div>
      </div>

      {(dcr?.status === 'submitted' || dcr?.status === 'locked') && dcr.submittedAt && (
        <div className="af-enter flex items-start gap-3 rounded-xl border border-success/40 bg-success-soft p-4" role="status" data-testid="dcr-success">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="flex flex-col gap-0.5 text-sm">
            <p className="font-medium">Report submitted {dcr.status === 'locked' ? `on ${dateLabel(istDay(dcr.submittedAt))}, ` : ''}at {timeLabel(dcr.submittedAt)}</p>
            <p className="text-muted-foreground">
              {dcr.status === 'locked' ? 'The day is locked, so it is read-only.' : 'It is read-only now.'} Ask your manager if something needs correcting.
            </p>
          </div>
        </div>
      )}

      {loadError && apiMissing ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="dcr-api-missing">
          <span>The new daily report isn’t available on this server yet. Use the classic report for now.</span>
          <Button type="button" size="sm" variant="outline" asChild>
            <Link href="/dcr/classic">Open classic report</Link>
          </Button>
        </div>
      ) : loadError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-danger-soft p-4 text-sm" role="alert" data-testid="dcr-load-error">
          {loadError}
          <Button type="button" size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}><RotateCw aria-hidden /> Retry</Button>
        </div>
      )}

      {daySubmitted && dcr?.status !== 'submitted' && (
        <div className="af-fade flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm" role="status" data-testid="dcr-day-submitted">
          <p>
            <span className="font-medium">You already submitted a report for {dateLabel(s.date)}.</span>{' '}
            Only one report per day can be submitted, so this {dcr ? 'draft' : 'form'} can’t be saved or submitted.
            {dcr?.status === 'draft' ? ' You can delete it.' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            {daySubmitted.id && onOpenReport && (
              <Button type="button" size="sm" variant="outline" onClick={() => onOpenReport(daySubmitted.id!, s.date)} data-testid="dcr-view-submitted">
                View submitted report
              </Button>
            )}
            {dcr?.status === 'draft' && onDelete && (
              <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(dcr)} data-testid="dcr-day-submitted-delete">
                <Trash2 aria-hidden /> Delete this draft
              </Button>
            )}
          </div>
        </div>
      )}

      {stale && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm" role="status" data-testid="dcr-stale">
          This report changed on the server since you opened it.
          <Button type="button" size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}><RotateCw aria-hidden /> Reload</Button>
        </div>
      )}

      {!dateLocked && !dcr && <Step title="Date" hint="Any day that isn’t locked. You can keep several drafts for the same day and submit one." testId="dcr-step-date">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dcr-date" className="sr-only">Report date</Label>
          <Input
            id="dcr-date"
            type="date"
            value={s.date}
            max={today}
            onChange={(e) => {
              const v = e.target.value;
              if (!v || v === s.date) return;
              if (dirty && !readOnly && !window.confirm('You have unsaved changes on this date. Switch date and discard them?')) return;
              setS(fresh(v));
            }}
            className="min-h-11 w-48 md:text-base"
            data-testid="dcr-date"
          />
        </div>
      </Step>}

      {workTypes === null && !loadError ? (
        <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-5 w-32" /><Skeleton className="h-24 w-full" /></div>
      ) : workTypes && (
        <Step title="Work on" hint="What you spent the day on." testId="dcr-step-workon">
          {choices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No work types are set up yet. Ask your administrator.</p>
          ) : (
            <ChoiceSelect
              aria-label="Work on"
              value={s.workOn?.key ?? ''}
              onValueChange={chooseWorkOn}
              choices={choices.map((c) => ({ value: c.key, label: c.label, hint: WORK_ON_HINT[c.branch] }))}
              placeholder="Choose what you worked on"
              disabled={readOnly}
              invalid={errorsFor('workOn').length > 0}
              className="sm:max-w-sm"
              testId="dcr-workon"
            />
          )}
          <FieldError messages={errorsFor('workOn')} />
          {!field && s.territoryIds.length > 0 && !readOnly && (
            <p className="text-xs text-muted-foreground" data-testid="dcr-field-kept">Your Field entries are kept on this page if you switch back. They are not saved with this report.</p>
          )}
        </Step>
      )}

      {field && (
        <Step title="Band" hint="Where the field day took you. This decides which SFC route and TA/DA apply." testId="dcr-step-band">
          <ChoiceSelect
            aria-label="Band"
            value={s.workOn!.workTypes.find((w) => w.id === s.workTypeId)?.band ?? ''}
            onValueChange={(band) => {
              const wt = s.workOn!.workTypes.find((w) => w.band === band);
              if (wt) chooseBand(wt.id);
            }}
            choices={BANDS.map((b) => {
              const set = s.workOn!.workTypes.some((w) => w.band === b.band);
              return { value: b.band, label: `${b.short} · ${b.label}`, hint: set ? b.hint : 'Not set up for your company', disabled: !set };
            })}
            placeholder="Choose HQ, EX or OS"
            disabled={readOnly}
            invalid={errorsFor('band').length > 0}
            className="sm:max-w-sm"
            testId="dcr-band"
          />
          <FieldError messages={errorsFor('band')} />
        </Step>
      )}

      {field && s.workTypeId && (
        <Step title="Territory" hint="Pick a whole HQ or the towns you covered. You can pick more than one." testId="dcr-step-territory" id="dcr-territory">
          <SearchSelect
            label="Territories"
            options={territoryOptions}
            loading={hqs === null && !hqError}
            error={hqError}
            onRetry={loadHqs}
            value={s.territoryIds}
            onChange={chooseTerritories}
            multiple
            placeholder="Choose territories"
            emptyText="No territories in your scope. Ask your administrator if yours is missing."
            disabled={readOnly}
            invalid={errorsFor('territory').length > 0}
            testId="dcr-territory"
          />
          <FieldError messages={errorsFor('territory')} />
        </Step>
      )}

      {field && s.workTypeId && s.territoryIds.length > 0 && (
        <Step title="Work with" hint="Anyone who joined you in the field." testId="dcr-step-workwith">
          <SearchSelect
            label="People"
            options={peopleOptions}
            loading={people === null && !peopleError}
            error={peopleError}
            onRetry={() => setPeopleTick((n) => n + 1)}
            onQuery={setPeopleQ}
            value={s.workWith}
            labels={personNames}
            onChange={(ids) => update({ workWith: ids })}
            onDone={() => update({ workWithDone: true })}
            multiple
            placeholder="Choose people"
            doneLabel="Confirm"
            emptyText="Nobody found. Try another name or code."
            disabled={readOnly}
            testId="dcr-workwith"
          />
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant={s.workWithDone && !s.workWith.length ? 'default' : 'outline'} size="sm" onClick={() => update({ workWith: [], workWithDone: true })} data-testid="dcr-alone">
                Worked alone
              </Button>
              {s.workWith.length > 0 && !s.workWithDone && (
                <Button type="button" size="sm" onClick={() => update({ workWithDone: true })} data-testid="dcr-workwith-confirm">Confirm {s.workWith.length} {s.workWith.length === 1 ? 'person' : 'people'}</Button>
              )}
            </div>
          )}
          <FieldError messages={errorsFor('workWith')} />
        </Step>
      )}

      {(showSfc || (readOnly && field && !!dcr?.sfcRoutes.length)) && (
        <Step title="SFC and TA/DA" hint="Matched from your SFC for this date, band and territory." testId="dcr-step-sfc">
          <SfcPanel
            state={s.sfc.state}
            hqs={s.sfc.hqs}
            choice={s.routeChoice}
            onChoose={(hq, id) => update((x) => ({ routeChoice: { ...x.routeChoice, [hq]: id } }))}
            onRetry={() => setSfcTick((n) => n + 1)}
            onChangeTerritory={() => {
              document.getElementById('dcr-territory')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              document.querySelector<HTMLButtonElement>('[data-testid=dcr-territory-trigger]')?.click();
            }}
            missingHqNames={missingHqIds.map((id) => hqNames.get(id) ?? 'one HQ')}
            snapshots={dcr?.sfcRoutes}
            readOnly={readOnly}
          />
          <FieldError messages={errorsFor('sfc')} />
        </Step>
      )}

      {(callsOpen || (readOnly && field)) && (
        <Step title="Calls" hint="One card per visit. Add as many as you made." testId="dcr-step-calls">
          {s.calls.length > 0 && (
            <ol className="flex flex-col gap-3">
              {s.calls.map((c, i) => (
                <CallCard
                  key={c.clientId}
                  call={c}
                  index={i}
                  scope={customerScope}
                  names={placeNames}
                  products={products}
                  productsError={productsError}
                  onProductsRetry={() => setProductsTick((n) => n + 1)}
                  readOnly={readOnly}
                  errors={errorsFor(`call-${c.clientId}`)}
                  onChange={(p) => patchCall(c.clientId, p)}
                  onRemove={() => update((x) => ({ calls: x.calls.filter((y) => y.clientId !== c.clientId) }))}
                />
              ))}
            </ol>
          )}
          {!readOnly && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(Object.keys(KIND_LABEL) as CallKind[]).map((k) => (
                <Button key={k} type="button" variant="outline" className="min-h-11 justify-start" onClick={() => addCall(k)} data-testid={`dcr-add-${k}`}>
                  <Plus aria-hidden /> Add {KIND_LABEL[k]}
                </Button>
              ))}
            </div>
          )}
          <FieldError messages={errorsFor('calls')} />
        </Step>
      )}

      {(branch === 'meeting' || branch === 'training') && (
        <Step title={branch === 'meeting' ? 'Meeting details' : 'Training details'} testId="dcr-step-details">
          <MeetingFields kind={branch} value={s.meeting} onChange={(v) => update({ meeting: v })} readOnly={readOnly} errors={errorsByField(['title', 'location', 'startTime', 'durationMin'])} />
        </Step>
      )}
      {branch === 'office' && (
        <Step title="Admin work details" testId="dcr-step-details">
          <OfficeFields value={s.office} onChange={(v) => update({ office: v })} readOnly={readOnly} errors={errorsByField(['taskType', 'description', 'durationMin'])} />
        </Step>
      )}
      {branch === 'leave' && (
        <Step title="Leave" hint="Link the leave request that covers this date." testId="dcr-step-details">
          <LeaveFields date={s.date} value={s.leaveRequestId} onChange={(id) => update({ leaveRequestId: id })} readOnly={readOnly} errors={errorsFor('leave')} />
        </Step>
      )}

      {s.workOn && (askDeviation || !!s.deviationReason) && (
        <Step title="Change from your tour plan" hint="Your approved tour plan says something else for this day. Say why, then submit again." testId="dcr-step-deviation">
          <Label htmlFor="dcr-deviation" className="sr-only">Reason for the change</Label>
          <textarea
            id="dcr-deviation"
            value={s.deviationReason}
            maxLength={500}
            rows={2}
            disabled={readOnly}
            onChange={(e) => update({ deviationReason: e.target.value })}
            placeholder="e.g. Doctor on leave, covered Arambagh instead"
            className="w-full rounded-md border bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
            data-testid="dcr-deviation"
          />
        </Step>
      )}

      {s.workOn && !readOnly && (
        <div className="sticky bottom-0 z-20 -mx-4 border-t bg-background/95 backdrop-blur-sm sm:-mx-6" data-testid="dcr-actions">
          <div className="flex w-full flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-sm text-muted-foreground" data-testid="dcr-review">
              {probs.length ? `${probs.length} thing${probs.length > 1 ? 's' : ''} left before you can submit` : field ? `Ready: ${s.calls.length} call${s.calls.length === 1 ? '' : 's'}, ${s.sfc.hqs.length} SFC route${s.sfc.hqs.length === 1 ? '' : 's'}` : 'Ready to submit'}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              {dcr?.status === 'draft' && onDelete && (
                <Button type="button" variant="ghost" className="col-span-2 min-h-11 text-destructive hover:text-destructive sm:col-span-1" disabled={!!saving} onClick={() => onDelete(dcr)} data-testid="dcr-delete">
                  <Trash2 aria-hidden /> Delete draft
                </Button>
              )}
              <Button type="button" variant="outline" className="min-h-11" disabled={!!saving || !s.workTypeId} onClick={() => void save(false)} data-testid="dcr-save">
                {saving === 'draft' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button type="button" className="min-h-11" disabled={!!saving || !s.workTypeId} onClick={() => void save(true)} data-testid="dcr-submit">
                {saving === 'submit' ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
          </div>
          {showErrors && probs.length > 0 && (
            <ul className="w-full px-4 pb-3 text-sm text-destructive sm:px-6" role="alert" data-testid="dcr-problems">
              {probs.slice(0, 4).map((p) => <li key={p.key + p.text}>{p.text}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
