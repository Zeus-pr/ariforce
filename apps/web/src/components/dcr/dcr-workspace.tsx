'use client';

import { ChevronUp, FilePen, History, Plus, RotateCw } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Dcr, TourPlan } from '@ariforce/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@ariforce/ui/components/alert-dialog';
import { Button } from '@ariforce/ui/components/button';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { toast } from '@ariforce/ui/components/sonner';
import { dateLabel, todayIST } from '@/components/attendance/format';
import { thisMonthIST } from '@/components/tour-plans/month';
import { api, apiReady, toApiError } from '@/lib/api';
import { useSession } from '@/lib/mock-auth';
import {
  cursorFromYmd,
  dcrPillsByDate,
  groupDcrs,
  monthRange,
  type DayPill,
  type TpDraftCard,
} from '@/lib/dcr/calendar';
import { failureMessage, thrownMessage } from '@/lib/dcr/errors';
import { normaliseWorkTypes, type HqOption, type WorkTypeOption } from '@/lib/dcr/model';
import { DcrFlow, type FlowController } from './dcr-flow';
import { DcrHistory } from './dcr-history';
import { DcrMonthCalendar } from './month-calendar';
import { DcrStatusSections } from './status-sections';
import { Reveal } from './dcr-card-parts';

/**
 * DCR page: Calendar (month grid + status lists + in-place report) | History.
 * Deep links: /dcr?draft=<id>, /dcr?new=1, /dcr?date=YYYY-MM-DD, /dcr?tab=history, /dcr?view=<id>.
 */

const noop = () => () => {};
const DISCARD = 'This report has unsaved changes that can’t be saved as a draft yet. Discard them?';
const LOOKUP_BATCH_SIZE = 20;

async function runBatched<T>(items: T[], task: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += LOOKUP_BATCH_SIZE) {
    await Promise.all(items.slice(i, i + LOOKUP_BATCH_SIZE).map(task));
  }
}

type Open = {
  key: string;
  date: string;
  draftId: string | null;
  isNew: boolean;
  submitted?: boolean;
};

type ApprovedTpDraft = {
  id: string;
  from: string;
  to: string;
  pendingDates: string[];
  draftDates: string[];
  plan: { workTypeId: string; territoryIds: string[] };
};

export function DcrWorkspace() {
  const today = useSyncExternalStore(noop, todayIST, () => null);
  const session = useSession();
  if (!today || session === undefined) return <div className="h-[560px]" aria-busy="true" />;
  return <Workspace today={today} />;
}

type Tab = 'calendar' | 'history';

function Workspace({ today }: { today: string }) {
  const [workTypes, setWorkTypes] = useState<WorkTypeOption[]>([]);
  const [hqs, setHqs] = useState<HqOption[]>([]);
  const [approvedTpDrafts, setApprovedTpDrafts] = useState<ApprovedTpDraft[]>([]);
  const [link] = useState(() => new URLSearchParams(window.location.search));
  const viewId = link.get('view');
  const [tab, setTab] = useState<Tab>(
    link.get('tab') === 'history' || viewId ? 'history' : 'calendar',
  );
  const [justSubmitted, setJustSubmitted] = useState<Dcr | null>(null);

  useEffect(() => {
    void apiReady()
      .then(() =>
        Promise.all([
          api.GET('/v1/dcrs/options', { params: { query: { date: today } } }),
          api.GET('/v1/dcrs/territories', {}),
        ]),
      )
      .then(([o, t]) => {
        if (o.data) setWorkTypes(normaliseWorkTypes(o.data.workTypes as WorkTypeOption[]));
        if (o.data) {
          const extended = o.data as typeof o.data & {
            tourPlanDrafts?: ApprovedTpDraft[];
          };
          setApprovedTpDrafts(extended.tourPlanDrafts ?? []);
        }
        if (t.data) setHqs(t.data.items);
      })
      .catch(() => {});
  }, [today]);

  const placeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of hqs) {
      m.set(h.id, h.name);
      for (const t of h.territories) m.set(t.id, t.name);
    }
    return m;
  }, [hqs]);
  const wtName = useCallback((id: string) => workTypes.find((w) => w.id === id)?.name, [workTypes]);

  const changeTab = (t: Tab) => {
    setTab(t);
    const u = new URL(window.location.href);
    for (const k of ['tab', 'view', 'draft', 'new', 'date']) u.searchParams.delete(k);
    if (t === 'history') u.searchParams.set('tab', 'history');
    window.history.replaceState(window.history.state, '', u);
  };
  const onSubmitted = (d: Dcr) => {
    setJustSubmitted(d);
    changeTab('history');
  };

  return (
    <Tabs value={tab} onValueChange={(v) => changeTab(v as Tab)} className="gap-4">
      <TabsList className="w-full sm:w-fit" data-testid="dcr-tabs">
        <TabsTrigger value="calendar" className="px-3" data-testid="dcr-tab-calendar">
          <FilePen aria-hidden /> Calendar
        </TabsTrigger>
        <TabsTrigger value="history" className="px-3" data-testid="dcr-tab-history">
          <History aria-hidden /> History
        </TabsTrigger>
      </TabsList>
      <TabsContent value="calendar" forceMount className="data-[state=inactive]:hidden">
        <CalendarPanel
          today={today}
          wtName={wtName}
          placeName={placeName}
          approvedTpDrafts={approvedTpDrafts}
          onSubmitted={onSubmitted}
        />
      </TabsContent>
      <TabsContent value="history" forceMount className="data-[state=inactive]:hidden">
        <DcrHistory
          today={today}
          active={tab === 'history'}
          wtName={wtName}
          placeName={placeName}
          submitted={justSubmitted}
          viewId={viewId}
        />
      </TabsContent>
    </Tabs>
  );
}

function CalendarPanel({
  today,
  wtName,
  placeName,
  approvedTpDrafts,
  onSubmitted,
}: {
  today: string;
  wtName: (id: string) => string | undefined;
  placeName: Map<string, string>;
  approvedTpDrafts: ApprovedTpDraft[];
  onSubmitted: (d: Dcr) => void;
}) {
  const [link] = useState(() => new URLSearchParams(window.location.search));
  const initialDate =
    link.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(link.get('date')!) ? link.get('date')! : today;
  const [month, setMonth] = useState(() => initialDate.slice(0, 7) || thisMonthIST());
  const [selected, setSelected] = useState<string | null>(initialDate);
  const [items, setItems] = useState<Dcr[] | null>(null);
  const [outletName, setOutletName] = useState<Map<string, string>>(() => new Map());
  const [plan, setPlan] = useState<TourPlan | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<Open | null>(null);
  const [closing, setClosing] = useState(false);
  const [confirm, setConfirm] = useState<Dcr | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [announce, setAnnounce] = useState('');
  const ctrl = useRef<FlowController>(null);
  const seq = useRef(0);
  const focusTarget = useRef<string | null>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const newBtn = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const switching = useRef(false);
  const deleteOnClose = useRef<string | null>(null);
  const monthLoad = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const cursor = useMemo(() => cursorFromYmd(`${month}-01`), [month]);
  const range = useMemo(() => monthRange(cursor.year, cursor.monthIndex), [cursor]);

  const loadMonth = useCallback(async () => {
    setListError(null);
    try {
      await apiReady();
      const [firstPage, plan] = await Promise.all([
        api.GET('/v1/dcrs', {
          params: {
            query: {
              mine: 'true',
              from: range.from,
              to: range.to,
              sort: '-date',
              limit: 100,
            },
          },
        }),
        api.GET('/v1/tour-plans/{month}', { params: { path: { month } } }),
      ]);
      if (!firstPage.data) {
        setListError(failureMessage(firstPage, 'Could not load your DCRs for this month.'));
        return;
      }
      const merged = new Map(firstPage.data.items.map((d) => [d.id, d]));
      let nextCursor = firstPage.data.nextCursor;
      while (nextCursor) {
        const page = await api.GET('/v1/dcrs', {
          params: {
            query: {
              mine: 'true',
              from: range.from,
              to: range.to,
              sort: '-date',
              limit: 100,
              cursor: nextCursor,
            },
          },
        });
        if (!page.data) {
          setListError(failureMessage(page, 'Could not load all DCRs for this month.'));
          return;
        }
        for (const d of page.data.items) merged.set(d.id, d);
        nextCursor = page.data.nextCursor;
      }
      // List rows sometimes omit call bodies — hydrate enough to label calendar cells.
      const thin = [...merged.values()].filter((d) => (d.callCount ?? 0) > 0 && !d.calls?.length);
      await runBatched(thin, async (d) => {
        const r = await api.GET('/v1/dcrs/{id}', { params: { path: { id: d.id } } });
        if (r.data) merged.set(d.id, r.data);
      });
      const all = [...merged.values()];
      setItems(all);
      setPlan(plan.data ?? null);
    } catch (e) {
      setListError(thrownMessage(e));
    }
  }, [month, range.from, range.to]);

  const monthLoadKey = `${month}:${reload}`;
  useEffect(() => {
    if (monthLoad.current?.key === monthLoadKey) return;
    setItems(null);
    setPlan(null);
    setOutletName(new Map());
    const promise = loadMonth();
    monthLoad.current = { key: monthLoadKey, promise };
    void promise.then(() => {
      if (monthLoad.current?.promise === promise) monthLoad.current = null;
    });
  }, [loadMonth, monthLoadKey]);

  const tpCards = useMemo(() => {
    if (items === null) return [];
    const filed = new Set(items.filter((d) => d.status !== 'draft').map((d) => d.date));
    const drafted = new Set(items.filter((d) => d.status === 'draft').map((d) => d.date));
    const liveTpCards = tpCardsFromApprovedItems(approvedTpDrafts, placeName, wtName, month);
    return liveTpCards.length ? liveTpCards : tpCardsFromPlan(plan, filed, drafted, today, month);
  }, [approvedTpDrafts, items, month, plan, placeName, today, wtName]);

  // Resolve doctor / chemist / stockist names for calendar day cells.
  useEffect(() => {
    if (!items?.length) return;
    const refs = new Map<string, 'doctor' | 'chemist' | 'stockist'>();
    for (const d of items) {
      for (const c of d.calls ?? []) {
        if (c.outletId && !refs.has(c.outletId)) refs.set(c.outletId, c.outletKind);
      }
    }
    if (!refs.size) return;
    let live = true;
    void (async () => {
      await apiReady();
      const found = new Map<string, string>();
      const doctors = [...refs.entries()].filter(([, k]) => k === 'doctor').map(([id]) => id);
      const others = {
        chemist: [...refs.entries()].filter(([, k]) => k === 'chemist').map(([id]) => id),
        stockist: [...refs.entries()].filter(([, k]) => k === 'stockist').map(([id]) => id),
      };
      const jobs: (() => Promise<void>)[] = [];
      for (let i = 0; i < doctors.length; i += 100) {
        const batch = doctors.slice(i, i + 100);
        jobs.push(() =>
          api
            .GET('/v1/doctors', { params: { query: { ids: batch.join(','), limit: 100 } } })
            .then((r) => {
              r.data?.items.forEach((d) => found.set(d.id, d.name));
            }),
        );
      }
      for (const kind of ['chemist', 'stockist'] as const) {
        for (let i = 0; i < others[kind].length; i += 100) {
          const batch = others[kind].slice(i, i + 100);
          jobs.push(async () => {
            const params = { query: { ids: batch.join(','), limit: 100 } };
            const r =
              kind === 'chemist'
                ? await api.GET('/v1/chemists', { params })
                : await api.GET('/v1/stockists', { params });
            r.data?.items.forEach((item) => found.set(item.id, item.name));
          });
        }
      }
      await runBatched(jobs, (job) => job());
      if (live && found.size) setOutletName((prev) => new Map([...prev, ...found]));
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [items]);

  // Deep links once the month list is in.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || items === null) return;
    linked.current = true;
    const q = new URLSearchParams(window.location.search);
    const id = q.get('draft');
    const d = id ? items.find((x) => x.id === id) : undefined;
    if (d) {
      setSelected(d.date);
      setOpen({
        key: d.id,
        date: d.date,
        draftId: d.id,
        isNew: false,
        submitted: d.status !== 'draft',
      });
      focusTarget.current = 'header';
    } else if (q.get('new') === '1') {
      const date =
        q.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(q.get('date')!) ? q.get('date')! : today;
      setSelected(date);
      setOpen({ key: 'new-link', date, draftId: null, isNew: true });
      focusTarget.current = 'header';
    } else if (q.get('date') && /^\d{4}-\d{2}-\d{2}$/.test(q.get('date')!)) {
      setSelected(q.get('date'));
    }
  }, [items, today]);

  const pills = useMemo(
    () => dcrPillsByDate(items ?? [], tpCards, wtName, placeName, outletName),
    [items, tpCards, wtName, placeName, outletName],
  );
  const groups = useMemo(() => groupDcrs(items ?? []), [items]);

  const settleOpen = useCallback(async (): Promise<boolean> => {
    const c = ctrl.current;
    if (!open || closing || !c || !c.isDirty()) return true;
    if (c.canSave()) return c.saveDraft();
    return window.confirm(DISCARD);
  }, [open, closing]);

  const switchTo = useCallback(
    async (next: Open) => {
      if (busy.current) return;
      busy.current = true;
      try {
        switching.current = true;
        const ok = await settleOpen();
        switching.current = false;
        if (!ok) return;
        setClosing(false);
        setSelected(next.date);
        setOpen(next);
        focusTarget.current = 'header';
        const u = new URL(window.location.href);
        for (const k of ['draft', 'new', 'view', 'tab']) u.searchParams.delete(k);
        u.searchParams.set('date', next.date);
        if (next.draftId) u.searchParams.set('draft', next.draftId);
        else if (next.isNew) u.searchParams.set('new', '1');
        window.history.replaceState(window.history.state, '', u);
      } finally {
        switching.current = false;
        busy.current = false;
      }
    },
    [settleOpen],
  );

  const openDcr = (d: Dcr) => {
    if (open?.draftId === d.id && !closing) return;
    void switchTo({
      key: d.id,
      date: d.date,
      draftId: d.id,
      isNew: false,
      submitted: d.status !== 'draft',
    });
  };

  const openNew = (date: string) => {
    seq.current += 1;
    void switchTo({ key: `new-${seq.current}`, date, draftId: null, isNew: true });
  };

  const onSelectDay = (date: string, dayPills: DayPill[]) => {
    setSelected(date);
    const uniqueIds = [
      ...new Set(
        dayPills
          .filter((p) => !p.itemId.startsWith('tp:'))
          .map((p) => p.itemId.replace(/:\d+$/, '')),
      ),
    ];
    if (uniqueIds.length === 1) {
      const d = (items ?? []).find((x) => x.id === uniqueIds[0]);
      if (d) {
        openDcr(d);
        return;
      }
    }
    if (dayPills.length === 1 && dayPills[0]!.itemId.startsWith('tp:')) {
      openNew(date);
      return;
    }
    if (!dayPills.length) openNew(date);
  };

  const collapse = async () => {
    if (!open || closing || busy.current) return;
    const c = ctrl.current;
    if (c?.isDirty()) {
      if (c.canSave()) {
        busy.current = true;
        try {
          await c.saveDraft();
        } finally {
          busy.current = false;
        }
        return;
      }
      if (!window.confirm(DISCARD)) return;
    }
    focusTarget.current = 'new';
    setClosing(true);
  };

  const onSaved = (d: Dcr, submitted: boolean) => {
    setItems((xs) => {
      const next = (xs ?? []).filter((x) => x.id !== d.id);
      if (!submitted || d.status !== 'draft') next.push(d);
      return next;
    });
    setOpen((o) => (o ? { ...o, draftId: d.id, date: d.date, isNew: false, submitted } : o));
    if (submitted) {
      focusTarget.current = null;
      setOpen(null);
      setClosing(false);
      onSubmitted(d);
      void loadMonth();
      return;
    }
    if (switching.current) return;
    setAnnounce(`Draft for ${dateLabel(d.date)} saved and collapsed.`);
    focusTarget.current = 'new';
    setClosing(true);
    void loadMonth();
  };

  const onClosed = useCallback(() => {
    const gone = deleteOnClose.current;
    deleteOnClose.current = null;
    if (gone) setItems((xs) => (xs ?? []).filter((x) => x.id !== gone));
    setOpen(null);
    setClosing(false);
  }, []);

  const doDelete = async () => {
    const d = confirm;
    if (!d || deleting) return;
    setDeleting(true);
    try {
      const r = await api.DELETE('/v1/dcrs/{id}', { params: { path: { id: d.id } } });
      const status = r.response?.status;
      if (r.error !== undefined && status !== 404) {
        const e = toApiError(r);
        if (e.code === 'ALREADY_SUBMITTED') {
          toast.error('This report is already submitted, so it can’t be deleted.', {
            duration: 10000,
          });
          setReload((n) => n + 1);
        } else if (e.code === 'DAY_LOCKED') {
          toast.error(
            'This day is locked, so the draft can’t be deleted. Ask your manager to reopen it.',
            { duration: 10000 },
          );
        } else
          toast.error(failureMessage(r, 'Could not delete the draft. Try again.'), {
            duration: 10000,
          });
        setConfirm(null);
        return;
      }
      toast.success(
        status === 404
          ? 'That draft was already deleted.'
          : `Draft for ${dateLabel(d.date)} deleted.`,
      );
      setAnnounce(`Draft for ${dateLabel(d.date)} deleted.`);
      if (open?.draftId === d.id) {
        deleteOnClose.current = d.id;
        setClosing(true);
      } else setItems((xs) => (xs ?? []).filter((x) => x.id !== d.id));
      setConfirm(null);
    } catch (e) {
      toast.error(`${thrownMessage(e)} The draft was not deleted.`, { duration: 10000 });
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  useLayoutEffect(() => {
    const t = focusTarget.current;
    if (!t) return;
    if (t === 'header' && open && !closing) {
      focusTarget.current = null;
      headerRef.current?.focus({ preventScroll: true });
      headerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (!open && t === 'new') {
      focusTarget.current = null;
      newBtn.current?.focus({ preventScroll: true });
    }
  });

  const editorId = 'dcr-open-report';
  const openTitle = !open
    ? ''
    : open.isNew && !open.draftId
      ? `New report · ${dateLabel(open.date)}`
      : `${open.submitted ? 'Report' : 'Draft'} · ${dateLabel(open.date)}`;

  const editor = open && (
    <Reveal key={open.key} closing={closing} onClosed={onClosed}>
      <div
        className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6"
        data-testid="dcr-open"
      >
        <div className="-mx-2 -mt-2 flex items-center justify-between gap-3">
          <button
            ref={headerRef}
            type="button"
            aria-expanded={!closing}
            aria-controls={editorId}
            onClick={() => void collapse()}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-testid="dcr-open-toggle"
          >
            <span className="truncate text-base font-semibold tracking-tight">{openTitle}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
              Collapse <ChevronUp className="size-4" aria-hidden />
            </span>
          </button>
        </div>
        <div id={editorId}>
          <DcrFlow
            key={open.key}
            initialDate={open.date}
            dateLocked
            reportId={open.draftId}
            onSaved={onSaved}
            onDelete={setConfirm}
            onOpenReport={(id, date) =>
              void switchTo({
                key: `report-${id}`,
                date,
                draftId: id,
                isNew: false,
                submitted: true,
              })
            }
            controller={ctrl}
          />
        </div>
      </div>
    </Reveal>
  );

  const empty = items !== null && !items.length && !tpCards.length;

  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Pick a day on the calendar to file or open a report.
        </p>
        <Button
          ref={newBtn}
          type="button"
          className="min-h-11"
          onClick={() => openNew(today)}
          data-testid="dcr-new"
        >
          <Plus aria-hidden /> New DCR
        </Button>
      </div>

      {listError ? (
        <div
          className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-danger-soft p-4 text-sm"
          role="alert"
          data-testid="dcr-calendar-error"
        >
          {listError}
          <Button type="button" size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}>
            <RotateCw aria-hidden /> Retry
          </Button>
        </div>
      ) : items === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-[320px] w-full rounded-xl" />
        </div>
      ) : (
        <>
          <DcrMonthCalendar
            month={month}
            today={today}
            selected={selected}
            pills={pills}
            onMonthChange={setMonth}
            onSelectDay={onSelectDay}
          />

          {open && editor}

          {empty && !open ? (
            <div
              className="af-fade flex flex-col items-start gap-1 rounded-xl border border-dashed p-5 text-sm"
              data-testid="dcr-calendar-empty"
            >
              <p className="font-medium">No DCRs this month</p>
              <p className="text-muted-foreground">
                Start today’s report with New DCR. Approved tour-plan days show on the calendar
                until you file them.
              </p>
            </div>
          ) : (
            <DcrStatusSections
              drafts={groups.drafts}
              pending={groups.pending}
              locked={groups.locked}
              approved={groups.approved}
              rejected={groups.rejected}
              tpCards={tpCards}
              wtName={wtName}
              placeName={placeName}
              onOpenDcr={openDcr}
              onOpenTp={(t) => {
                const date = t.draftDates?.[0] ?? t.pendingDates[0] ?? today;
                const existing = (items ?? []).find((d) => d.date === date && d.status === 'draft');
                if (existing) openDcr(existing);
                else openNew(date);
              }}
              onDeleteDraft={setConfirm}
            />
          )}
        </>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !deleting && setConfirm(null)}>
        <AlertDialogContent data-testid="dcr-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && (
                <>
                  The draft for {dateLabel(confirm.date)}
                  {wtName(confirm.workTypeId) ? ` (${wtName(confirm.workTypeId)})` : ''} and its
                  calls will be deleted. This can’t be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
              data-testid="dcr-delete-confirm"
            >
              {deleting ? 'Deleting…' : 'Delete draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function tpCardsFromApprovedItems(
  items: ApprovedTpDraft[],
  placeName: Map<string, string>,
  wtName: (id: string) => string | undefined,
  month: string,
): TpDraftCard[] {
  return items
    .flatMap((item) => {
      const pendingDates = item.pendingDates.filter((date) => date.startsWith(month));
      if (!pendingDates.length) return [];
      const territories = item.plan.territoryIds
        .map((id) => placeName.get(id))
        .filter((name): name is string => !!name);
      return [
        {
          id: item.id,
          from: item.from,
          to: item.to,
          pendingDates,
          draftDates: item.draftDates.filter((date) => pendingDates.includes(date)),
          label:
            territories.slice(0, 2).join(' · ') ||
            wtName(item.plan.workTypeId) ||
            'Approved tour plan · file as DCR',
        },
      ];
    })
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** Approved TP days in this month that are not yet filed (and not already a draft). */
function tpCardsFromPlan(
  plan: TourPlan | null,
  filed: Set<string>,
  drafted: Set<string>,
  today: string,
  month: string,
): TpDraftCard[] {
  if (!plan) return [];
  const pending = plan.days
    .filter((d) => d.status === 'approved' && d.entries.length > 0)
    .map((d) => d.date)
    .filter(
      (date) =>
        date.startsWith(month) &&
        !filed.has(date) &&
        !drafted.has(date) &&
        date >= today.slice(0, 7) + '-01',
    );
  // Show future approved days as TP pills too (draft until the day); keep past unfiled as well.
  const allPending = plan.days
    .filter((d) => d.status === 'approved' && d.entries.length > 0)
    .map((d) => d.date)
    .filter((date) => date.startsWith(month) && !filed.has(date) && !drafted.has(date));
  const dates = allPending.length ? allPending : pending;
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  return [
    {
      id: plan.id,
      from: sorted[0]!,
      to: sorted[sorted.length - 1]!,
      pendingDates: sorted,
      label: 'Approved tour plan · file as DCR',
    },
  ];
}
