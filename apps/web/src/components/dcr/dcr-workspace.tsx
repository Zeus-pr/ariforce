'use client';

import { ChevronDown, ChevronUp, FileText, Plus, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Dcr } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { cn } from '@ariforce/ui/lib/utils';
import { dateLabel, todayIST } from '@/components/attendance/format';
import { api, apiReady } from '@/lib/api';
import { useSession } from '@/lib/mock-auth';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { BANDS, normaliseWorkTypes, type HqOption, type WorkTypeOption } from '@/lib/dcr/model';
import { failureMessage, thrownMessage } from '@/lib/dcr/errors';
import { DcrFlow, type FlowController } from './dcr-flow';

/**
 * The DCR page: saved drafts as compact cards, at most one report open at a time.
 * Save draft collapses the open report into its card; a card (click, Enter or Space) expands back into the
 * report exactly as saved. Drafts come from GET /v1/dcrs?userId=<me>&status=draft&sort=-updatedAt.
 * The API keeps one report per user and date, so "another separate draft" means another date.
 */

const noop = () => () => {};
const MOTION_MS = 240;
const savedLabel = (iso: string) =>
  `${new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso))} IST`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const shiftDay = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

type Open = { key: string; date: string; draftId: string | null; isNew: boolean; existing?: boolean };

export function DcrWorkspace() {
  const today = useSyncExternalStore(noop, todayIST, () => null);
  const session = useSession();
  if (!today || session === undefined) return <div className="h-[560px]" aria-busy="true" />;
  return <Workspace today={today} userId={session?.user.id ?? null} />;
}

function Workspace({ today, userId }: { today: string; userId: string | null }) {
  const [drafts, setDrafts] = useState<Dcr[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [workTypes, setWorkTypes] = useState<WorkTypeOption[]>([]);
  const [hqs, setHqs] = useState<HqOption[]>([]);
  const [open, setOpen] = useState<Open | null>({ key: 'new-0', date: today, draftId: null, isNew: true });
  const [closing, setClosing] = useState(false);
  const [announce, setAnnounce] = useState('');
  const ctrl = useRef<FlowController>(null);
  const seq = useRef(0);
  const focusTarget = useRef<string | null>(null);
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
        const r = await api.GET('/v1/dcrs', {
          params: { query: { status: 'draft', sort: '-updatedAt', limit: 50, ...(userId ? { userId } : {}) } },
        });
        if (!live) return;
        if (!r.data) return setListError(failureMessage(r, 'Could not load your saved drafts.'));
        setDrafts(r.data.items.filter((d) => d.status === 'draft' && (!userId || d.userId === userId)));
      } catch (e) {
        if (live) setListError(thrownMessage(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [userId, reload]);

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

  const live = useMemo(() => (drafts ?? []).filter((d) => d.status === 'draft'), [drafts]);
  const sorted = useMemo(
    () => (drafts ?? []).filter((d) => d.status === 'draft' || d.id === open?.draftId).slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
    [drafts, open?.draftId],
  );

  /** Settle the open report before another opens: autosave when it can, otherwise ask. */
  const settleOpen = useCallback(async (): Promise<boolean> => {
    const c = ctrl.current;
    if (!open || !c || !c.isDirty()) return true;
    if (c.canSave()) return c.saveDraft();
    return window.confirm('This report has unsaved changes that can’t be saved as a draft yet. Discard them?');
  }, [open]);

  const show = useCallback((next: Open) => {
    setClosing(false);
    setOpen(next);
    focusTarget.current = 'header';
  }, []);

  const switchTo = useCallback(
    async (next: Open) => {
      if (busy.current) return;
      busy.current = true;
      try {
        switching.current = true;
        const ok = await settleOpen();
        switching.current = false;
        if (ok) show(next);
      } finally {
        switching.current = false;
        busy.current = false;
      }
    },
    [settleOpen, show],
  );

  const openDraft = (d: Dcr) => {
    if (open?.draftId === d.id && !closing) return;
    void switchTo({ key: d.id, date: d.date, draftId: d.id, isNew: false });
  };

  const newDcr = () => {
    const taken = new Set((drafts ?? []).map((d) => d.date));
    if (open && !closing && open.draftId) taken.add(open.date);
    const date = !taken.has(today) ? today : !taken.has(shiftDay(today, -1)) ? shiftDay(today, -1) : today;
    seq.current += 1;
    void switchTo({ key: `new-${seq.current}`, date, draftId: null, isNew: true });
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
      if (!window.confirm('This report has unsaved changes that can’t be saved as a draft yet. Discard them?')) return;
    }
    focusTarget.current = open.draftId ? `card:${open.draftId}` : 'new';
    setClosing(true);
  };

  const onSaved = (d: Dcr, submitted: boolean) => {
    // A submitted report stays in state (its card is hidden) so the open report keeps its place.
    setDrafts((xs) => [d, ...(xs ?? []).filter((x) => x.id !== d.id)]);
    setOpen((o) => (o ? { ...o, draftId: d.id, date: d.date } : o));
    if (submitted || switching.current) return;
    setAnnounce(`Draft for ${dateLabel(d.date)} saved and collapsed. Use New DCR to start another report.`);
    focusTarget.current = `card:${d.id}`;
    setClosing(true);
  };

  const onLoaded = (d: Dcr | null, date: string) => {
    setOpen((o) => {
      if (!o || !o.isNew) return o;
      const id = d?.status === 'draft' ? d.id : null;
      return o.draftId === id && o.date === date ? o : { ...o, draftId: id, date, existing: !!id };
    });
  };

  const onClosed = useCallback(() => {
    setOpen(null);
    setClosing(false);
  }, []);

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
      const el = t.startsWith('card:') ? document.querySelector<HTMLElement>(`[data-draft-card="${t.slice(5)}"]`) : null;
      (el ?? newBtn.current)?.focus({ preventScroll: true });
    }
  });

  const editorId = 'dcr-open-report';
  const wtName = (id: string) => workTypes.find((w) => w.id === id)?.name;

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
            <span className="truncate text-base font-semibold tracking-tight">
              {open.isNew && !open.draftId
                ? 'New report'
                : `${drafts?.find((x) => x.id === open.draftId)?.status === 'submitted' ? 'Submitted' : 'Draft'} · ${dateLabel(open.date)}`}
            </span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
              Collapse <ChevronUp className="size-4" aria-hidden />
            </span>
          </button>
        </div>
        {open.isNew && open.draftId && open.existing && (
          <p className="af-fade rounded-lg bg-info-soft px-3 py-2 text-sm text-info" data-testid="dcr-date-has-draft">
            {dateLabel(open.date)} already has a saved draft, so it’s open here. Pick another date for a separate report.
          </p>
        )}
        <div id={editorId}>
          <DcrFlow
            key={open.isNew ? open.key : open.draftId ?? open.key}
            initialDate={open.date}
            dateLocked={!open.isNew}
            onSaved={onSaved}
            onLoaded={onLoaded}
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
        <ul className="flex flex-col gap-3" aria-labelledby="dcr-drafts-h" data-testid="dcr-drafts">
          {sorted.map((d, i) =>
            open?.draftId === d.id ? (
              open.isNew ? null : <li key={d.id}>{editor}</li>
            ) : d.status !== 'draft' ? null : (
              <li key={d.id} className="af-enter" style={{ ['--i' as string]: i }}>
                <DraftCard d={d} workType={wtName(d.workTypeId)} placeName={placeName} controls={editorId} onOpen={() => openDraft(d)} />
              </li>
            ),
          )}
          {open && !open.isNew && !sorted.some((d) => d.id === open.draftId) && <li>{editor}</li>}
        </ul>
      )}
    </div>
  );
}

function DraftCard({
  d,
  workType,
  placeName,
  controls,
  onOpen,
}: {
  d: Dcr;
  workType: string | undefined;
  placeName: Map<string, string>;
  controls: string;
  onOpen: () => void;
}) {
  const band = BANDS.find((b) => b.band === d.band);
  const places = d.territoryIds.map((id) => placeName.get(id)).filter(Boolean) as string[];
  const territory = places.length ? places.join(', ') : d.territoryIds.length ? plural(d.territoryIds.length, 'territory').replace('territorys', 'territories') : null;
  const what = workType ?? (band ? 'Field work' : d.details?.kind ? d.details.kind[0]!.toUpperCase() + d.details.kind.slice(1) : 'Report');
  return (
    <button
      type="button"
      aria-expanded={false}
      aria-controls={controls}
      onClick={onOpen}
      data-draft-card={d.id}
      data-testid="dcr-draft-card"
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-xs outline-none',
        'transition-[border-color,box-shadow,transform] duration-(--duration-fast) ease-(--ease-out)',
        'hover:border-foreground/20 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:active:scale-100',
      )}
    >
      <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tracking-tight">{dateLabel(d.date)}</span>
          <span className="rounded-md bg-info-soft px-2 py-0.5 text-xs font-medium text-info">Draft</span>
        </span>
        <span className="text-sm text-muted-foreground">
          {[what, band ? band.label : null, territory, band || d.calls.length ? plural(d.calls.length, 'call') : null].filter(Boolean).join(' · ')}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">Saved {savedLabel(d.updatedAt)}</span>
      </span>
      <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) group-hover:translate-y-0.5 motion-reduce:transition-none" aria-hidden />
    </button>
  );
}

/** Height + opacity reveal (grid rows 0fr → 1fr), ease-out; instant when the OS asks for reduced motion. */
function Reveal({ closing, onClosed, children }: { closing: boolean; onClosed: () => void; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(r);
  }, []);
  useEffect(() => {
    if (!closing) return;
    setSettled(false);
    const t = window.setTimeout(onClosed, reduced ? 0 : MOTION_MS);
    return () => window.clearTimeout(t);
  }, [closing, onClosed, reduced]);
  const expanded = on && !closing;
  return (
    <div
      className="af-reveal"
      data-open={expanded}
      data-settled={(expanded && (settled || reduced)) || undefined}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows' && expanded) setSettled(true);
      }}
    >
      <div>{children}</div>
    </div>
  );
}
