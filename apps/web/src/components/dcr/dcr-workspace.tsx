'use client';

import { ChevronDown, ChevronUp, FilePen, FileText, History, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Dcr } from '@ariforce/contracts';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@ariforce/ui/components/tooltip';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { dateLabel, todayIST } from '@/components/attendance/format';
import { api, apiReady, toApiError } from '@/lib/api';
import { useSession } from '@/lib/mock-auth';
import { normaliseWorkTypes, type HqOption, type WorkTypeOption } from '@/lib/dcr/model';
import { failureMessage, thrownMessage } from '@/lib/dcr/errors';
import { DcrFlow, type FlowController } from './dcr-flow';
import { DcrHistory } from './dcr-history';
import { Reveal, dcrSummary, istLabel } from './dcr-card-parts';

/**
 * The DCR page, two tabs. "Today & drafts": saved drafts as compact cards, at most one report open at a time.
 * Save draft collapses the open report into its card; a card (click, Enter or Space) expands back into the
 * report exactly as saved. Several drafts per day are allowed; one report per day can be submitted
 * (API 0045). Drafts come from GET /v1/dcrs?mine=true&status=draft&sort=-updatedAt (callCount per item).
 * "History": the rep's submitted reports (./dcr-history). A submit moves the report there, highlighted.
 * Links: /dcr?draft=<id>, /dcr?new=1, /dcr?tab=history, /dcr?view=<id> (a submitted report, opened).
 */

const noop = () => () => {};
const newestFirst = (a: Dcr, b: Dcr) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);
const DISCARD = 'This report has unsaved changes that can’t be saved as a draft yet. Discard them?';

type Open = { key: string; date: string; draftId: string | null; isNew: boolean; submitted?: boolean };

export function DcrWorkspace() {
  const today = useSyncExternalStore(noop, todayIST, () => null);
  const session = useSession();
  if (!today || session === undefined) return <div className="h-[560px]" aria-busy="true" />;
  return <Workspace today={today} />;
}

type Tab = 'drafts' | 'history';

/** Tabs plus the names both lists use (work types, territories). */
function Workspace({ today }: { today: string }) {
  const [workTypes, setWorkTypes] = useState<WorkTypeOption[]>([]);
  const [hqs, setHqs] = useState<HqOption[]>([]);
  // Mounted only on the client (see DcrWorkspace), so the URL is readable here.
  const [link] = useState(() => new URLSearchParams(window.location.search));
  const viewId = link.get('view');
  const [tab, setTab] = useState<Tab>(link.get('tab') === 'history' || viewId ? 'history' : 'drafts');
  const [justSubmitted, setJustSubmitted] = useState<Dcr | null>(null);

  // Names for the cards: work types (one options call) and territories. Cards fall back to plain words.
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
    for (const k of ['tab', 'view', 'draft', 'new']) u.searchParams.delete(k);
    if (t === 'history') u.searchParams.set('tab', 'history');
    window.history.replaceState(window.history.state, '', u);
  };
  const onSubmitted = (d: Dcr) => {
    setJustSubmitted(d);
    changeTab('history');
  };

  // Both panels stay mounted (hidden when inactive) so an open draft keeps its unsaved edits.
  return (
    <Tabs value={tab} onValueChange={(v) => changeTab(v as Tab)} className="gap-4">
      <TabsList className="w-full sm:w-fit" data-testid="dcr-tabs">
        <TabsTrigger value="drafts" className="px-3" data-testid="dcr-tab-drafts">
          <FilePen aria-hidden /> Today &amp; drafts
        </TabsTrigger>
        <TabsTrigger value="history" className="px-3" data-testid="dcr-tab-history">
          <History aria-hidden /> History
        </TabsTrigger>
      </TabsList>
      <TabsContent value="drafts" forceMount className="data-[state=inactive]:hidden">
        <DraftsPanel today={today} wtName={wtName} placeName={placeName} onSubmitted={onSubmitted} />
      </TabsContent>
      <TabsContent value="history" forceMount className="data-[state=inactive]:hidden">
        <DcrHistory today={today} active={tab === 'history'} wtName={wtName} placeName={placeName} submitted={justSubmitted} viewId={viewId} />
      </TabsContent>
    </Tabs>
  );
}

function DraftsPanel({
  today,
  wtName,
  placeName,
  onSubmitted,
}: {
  today: string;
  wtName: (id: string) => string | undefined;
  placeName: Map<string, string>;
  /** A report was submitted: the page moves to History. */
  onSubmitted: (d: Dcr) => void;
}) {
  const [drafts, setDrafts] = useState<Dcr[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  /** Dates that already have a submitted report (drafts of those days can only be deleted). */
  const [submittedDays, setSubmittedDays] = useState<Map<string, string | null>>(new Map());
  // Everything starts collapsed: a draft opens only on click / Enter / Space (or a ?draft= / ?new=1 link).
  const [open, setOpen] = useState<Open | null>(null);
  const [closing, setClosing] = useState(false);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Dcr | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [announce, setAnnounce] = useState('');
  const ctrl = useRef<FlowController>(null);
  const seq = useRef(0);
  const focusTarget = useRef<string | null>(null);
  const afterDeleteFocus = useRef<string | null>(null);
  const deleteOnClose = useRef<string | null>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const newBtn = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  /** Saving the open report only to open another one: the switch replaces it, no collapse. */
  const switching = useRef(false);

  useEffect(() => {
    let live = true;
    setListError(null);
    void (async () => {
      try {
        await apiReady();
        const r = await api.GET('/v1/dcrs', { params: { query: { mine: 'true', status: 'draft', sort: '-updatedAt', limit: 50 } } });
        if (!live) return;
        if (!r.data) return setListError(failureMessage(r, 'Could not load your saved drafts.'));
        const items = r.data.items.filter((d) => d.status === 'draft');
        setDrafts(items);
        // Which of those days already have a submitted report (one call over the drafts' date range).
        const dates = items.map((d) => d.date).sort();
        if (!dates.length) return;
        const s = await api.GET('/v1/dcrs', {
          params: { query: { mine: 'true', status: 'submitted', from: dates[0], to: dates[dates.length - 1], limit: 100 } },
        });
        if (live && s.data) setSubmittedDays(new Map(s.data.items.filter((d) => d.status === 'submitted').map((d) => [d.date, d.id])));
      } catch (e) {
        if (live) setListError(thrownMessage(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [reload]);

  // Deep links: /dcr?draft=<id> opens that draft once the list is in; /dcr?new=1 opens a new report.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || drafts === null) return;
    linked.current = true;
    const q = new URLSearchParams(window.location.search);
    const id = q.get('draft');
    const d = id ? drafts.find((x) => x.id === id) : undefined;
    if (d) {
      setOpen({ key: d.id, date: d.date, draftId: d.id, isNew: false });
      focusTarget.current = 'header';
    } else if (q.get('new') === '1') {
      setOpen({ key: 'new-link', date: today, draftId: null, isNew: true });
      focusTarget.current = 'header';
    }
  }, [drafts, today]);

  const live = useMemo(() => (drafts ?? []).filter((d) => d.status === 'draft' && !removing.has(d.id)), [drafts, removing]);
  // A report that was just submitted keeps its place while it stays open.
  const sorted = useMemo(
    () => (drafts ?? []).filter((d) => d.status === 'draft' || d.id === open?.draftId).sort(newestFirst),
    [drafts, open?.draftId],
  );

  /** Settle the open report before another opens: autosave when it can, otherwise ask. */
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
        setOpen(next);
        focusTarget.current = 'header';
      } finally {
        switching.current = false;
        busy.current = false;
      }
    },
    [settleOpen],
  );

  const openDraft = (d: Dcr) => {
    if (open?.draftId === d.id && !closing) return;
    void switchTo({ key: d.id, date: d.date, draftId: d.id, isNew: false });
  };

  const openReport = (id: string, date: string) =>
    void switchTo({ key: `report-${id}`, date, draftId: id, isNew: false, submitted: true });

  const newDcr = () => {
    seq.current += 1;
    void switchTo({ key: `new-${seq.current}`, date: today, draftId: null, isNew: true });
  };

  const collapse = async () => {
    if (!open || closing || busy.current) return;
    const c = ctrl.current;
    if (c?.isDirty()) {
      if (c.canSave()) {
        // onSaved collapses it.
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
    focusTarget.current = open.draftId && !open.submitted ? `card:${open.draftId}` : 'new';
    setClosing(true);
  };

  const onSaved = (d: Dcr, submitted: boolean) => {
    if (submitted) {
      // It is not a draft any more: close it here and show it in History (the page switches tabs).
      setSubmittedDays((m) => new Map(m).set(d.date, d.id));
      setDrafts((xs) => (xs ?? []).filter((x) => x.id !== d.id));
      focusTarget.current = null;
      setOpen(null);
      setClosing(false);
      onSubmitted(d);
      return;
    }
    setDrafts((xs) => [d, ...(xs ?? []).filter((x) => x.id !== d.id)]);
    setOpen((o) => (o ? { ...o, draftId: d.id, date: d.date } : o));
    if (switching.current) return;
    setAnnounce(`Draft for ${dateLabel(d.date)} saved and collapsed. Use New DCR to start another report.`);
    focusTarget.current = `card:${d.id}`;
    setClosing(true);
  };

  const onDaySubmitted = useCallback((date: string, id: string | null) => {
    setSubmittedDays((m) => (m.has(date) && m.get(date) === id ? m : new Map(m).set(date, id)));
  }, []);

  const onClosed = useCallback(() => {
    const gone = deleteOnClose.current;
    deleteOnClose.current = null;
    if (gone) setDrafts((xs) => (xs ?? []).filter((x) => x.id !== gone));
    setOpen(null);
    setClosing(false);
  }, []);

  const dropCard = useCallback((id: string) => {
    setDrafts((xs) => (xs ?? []).filter((x) => x.id !== id));
    setRemoving((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }, []);

  /** Where focus goes after a draft is deleted: the next card, else the previous one, else New DCR. */
  const focusAfterDelete = (id: string) => {
    const cards = sorted.filter((d) => d.status === 'draft' && !removing.has(d.id) && d.id !== open?.draftId);
    const i = cards.findIndex((d) => d.id === id);
    const rest = cards.filter((d) => d.id !== id);
    const next = i < 0 ? rest[0] : (cards[i + 1] ?? cards[i - 1]);
    return next ? `card:${next.id}` : 'new';
  };

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
          toast.error('This report is already submitted, so it can’t be deleted.', { duration: 10000 });
          setReload((n) => n + 1);
        } else if (e.code === 'DAY_LOCKED') toast.error('This day is locked, so the draft can’t be deleted. Ask your manager to reopen it.', { duration: 10000 });
        else toast.error(failureMessage(r, 'Could not delete the draft. Try again.'), { duration: 10000 });
        setConfirm(null);
        return;
      }
      toast.success(status === 404 ? 'That draft was already deleted.' : `Draft for ${dateLabel(d.date)} deleted.`);
      setAnnounce(`Draft for ${dateLabel(d.date)} deleted.`);
      afterDeleteFocus.current = focusAfterDelete(d.id);
      if (open?.draftId === d.id) {
        deleteOnClose.current = d.id;
        setClosing(true);
      } else setRemoving((s) => new Set(s).add(d.id));
      setConfirm(null);
    } catch (e) {
      toast.error(`${thrownMessage(e)} The draft was not deleted.`, { duration: 10000 });
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  // Focus follows the expand/collapse: into the report's header when it opens, back to its card when it closes.
  useLayoutEffect(() => {
    const t = focusTarget.current;
    if (!t) return;
    if (t === 'header' && open && !closing) {
      focusTarget.current = null;
      headerRef.current?.focus({ preventScroll: true });
      headerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (!open && t !== 'header') {
      focusTarget.current = null;
      focusCard(t);
    }
  });

  const focusCard = (t: string) => {
    const el = t.startsWith('card:') ? document.querySelector<HTMLElement>(`[data-draft-card="${t.slice(5)}"]`) : null;
    (el ?? newBtn.current)?.focus({ preventScroll: true });
  };

  const editorId = 'dcr-open-report';
  const openDcr = open?.draftId ? drafts?.find((x) => x.id === open.draftId) : undefined;
  const openTitle = !open
    ? ''
    : open.isNew && !open.draftId
      ? 'New report'
      : `${open.submitted || openDcr?.status === 'submitted' ? 'Submitted' : 'Draft'} · ${dateLabel(open.date)}`;

  const editor = open && (
    <Reveal key={open.key} closing={closing} onClosed={onClosed}>
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6" data-testid="dcr-open">
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
            dateLocked={!open.isNew}
            reportId={open.draftId}
            onSaved={onSaved}
            onDelete={setConfirm}
            onOpenReport={openReport}
            onDaySubmitted={onDaySubmitted}
            controller={ctrl}
          />
        </div>
      </div>
    </Reveal>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" aria-live="polite">{announce}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground" id="dcr-drafts-h">
          {drafts === null ? 'Saved drafts' : live.length ? `Saved drafts (${live.length})` : 'No saved drafts'}
        </h2>
        <Button ref={newBtn} type="button" className="min-h-11" onClick={newDcr} data-testid="dcr-new">
          <Plus aria-hidden /> New DCR
        </Button>
      </div>

      {open?.isNew && editor}

      {listError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-danger-soft p-4 text-sm" role="alert" data-testid="dcr-drafts-error">
          {listError}
          <Button type="button" size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}><RotateCw aria-hidden /> Retry</Button>
        </div>
      ) : drafts === null ? (
        <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-20 w-full rounded-xl" /></div>
      ) : (
        <>
        {!live.length && !open && (
          <div className="af-fade flex flex-col items-start gap-1 rounded-xl border border-dashed p-5 text-sm" data-testid="dcr-drafts-empty">
            <p className="font-medium">No saved drafts</p>
            <p className="text-muted-foreground">Start today’s report with New DCR. Save it as a draft to come back to it later.</p>
          </div>
        )}
        <ul className="flex flex-col" aria-labelledby="dcr-drafts-h" data-testid="dcr-drafts">
          {sorted.map((d, i) =>
            open?.draftId === d.id ? (
              open.isNew ? null : <li key={d.id} className="pb-3">{editor}</li>
            ) : d.status !== 'draft' ? null : (
              <li key={d.id} className="af-enter" style={{ ['--i' as string]: i }}>
                <Reveal appear={false} closing={removing.has(d.id)} onClosed={() => dropCard(d.id)}>
                  <div className="pb-3">
                    <DraftCard
                      d={d}
                      workType={wtName(d.workTypeId)}
                      placeName={placeName}
                      controls={editorId}
                      daySubmitted={submittedDays.has(d.date)}
                      onOpen={() => openDraft(d)}
                      onDelete={() => setConfirm(d)}
                    />
                  </div>
                </Reveal>
              </li>
            ),
          )}
          {open && !open.isNew && !sorted.some((d) => d.id === open.draftId) && <li className="pb-3">{editor}</li>}
        </ul>
        </>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && !deleting && setConfirm(null)}>
        <AlertDialogContent
          data-testid="dcr-delete-dialog"
          onCloseAutoFocus={(e) => {
            const t = afterDeleteFocus.current;
            if (!t) return;
            afterDeleteFocus.current = null;
            e.preventDefault();
            if (deleteOnClose.current) focusTarget.current = t;
            else focusCard(t);
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && (
                <>
                  The draft for {dateLabel(confirm.date)}
                  {wtName(confirm.workTypeId) ? ` (${wtName(confirm.workTypeId)})` : ''} and its calls will be deleted. This can’t be undone.
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

function DraftCard({
  d,
  workType,
  placeName,
  controls,
  daySubmitted,
  onOpen,
  onDelete,
}: {
  d: Dcr;
  workType: string | undefined;
  placeName: Map<string, string>;
  controls: string;
  daySubmitted: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const day = dateLabel(d.date);
  // One row: the report itself expands (chevron is part of that target); delete sits apart, past a divider.
  return (
    <div
      className={cn(
        'group/card flex items-stretch gap-2 rounded-xl border bg-card p-1.5 shadow-xs',
        'transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out) hover:border-foreground/20',
      )}
    >
      <button
        type="button"
        aria-expanded={false}
        aria-controls={controls}
        onClick={onOpen}
        data-draft-card={d.id}
        data-testid="dcr-draft-card"
        className={cn(
          'group flex min-w-0 flex-1 items-start gap-3 rounded-lg py-2.5 pr-1.5 pl-2.5 text-left outline-none',
          'transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-out)',
          'hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:active:scale-100',
        )}
      >
        <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tracking-tight">{day}</span>
            <span className="rounded-md bg-info-soft px-2 py-0.5 text-xs font-medium text-info">Draft</span>
            {daySubmitted && (
              <span className="rounded-md bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning" data-testid="dcr-card-day-submitted">
                Day already submitted
              </span>
            )}
          </span>
          <span className="text-sm text-muted-foreground">
            {dcrSummary(d, workType, placeName)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            Saved {istLabel(d.updatedAt)}
            {daySubmitted ? ' · Can’t be submitted; delete it if you no longer need it' : ''}
          </span>
        </span>
        <span
          className="flex size-10 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-colors duration-(--duration-fast) group-hover:bg-muted group-hover:text-foreground"
          aria-hidden
        >
          <ChevronDown className="size-4" />
        </span>
      </button>
      <span className="my-3 w-px shrink-0 bg-border" aria-hidden />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 self-center text-muted-foreground hover:bg-danger-soft hover:text-destructive focus-visible:text-destructive"
            onClick={onDelete}
            aria-label={`Delete draft for ${day}`}
            data-testid="dcr-card-delete"
          >
            <Trash2 aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Delete draft</TooltipContent>
      </Tooltip>
    </div>
  );
}
