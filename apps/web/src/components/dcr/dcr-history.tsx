'use client';

import { ChevronDown, ChevronUp, FileCheck2, History, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dcr } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { dateLabel } from '@/components/attendance/format';
import { api, apiReady } from '@/lib/api';
import { dcrBucket } from '@/lib/dcr/calendar';
import { failureMessage, thrownMessage } from '@/lib/dcr/errors';
import { DcrFlow } from './dcr-flow';
import { Reveal, dcrSummary, istLabel } from './dcr-card-parts';

/**
 * History tab of the DCR page: the rep's own reports that left draft, newest day first, as cards that
 * expand in place into the same report layout, read-only. Data: GET /v1/dcrs?mine=true&sort=-date with
 * unfiltered status from the last WINDOW_DAYS days, then "Show older" drops the from bound. Locked
 * rows that were never submitted are old drafts, not history, and are left out.
 */

export const HISTORY_WINDOW_DAYS = 60;
const PAGE = 20;
const HIGHLIGHT_MS = 2600;

type Phase = { key: string; from?: string; to?: string; cursor: string | null; done: boolean };

const shiftDay = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isHistory = (d: Dcr) => d.status !== 'draft' && !!d.submittedAt;
const newestDay = (a: Dcr, b: Dcr) =>
  a.date < b.date
    ? 1
    : a.date > b.date
      ? -1
      : (b.submittedAt ?? b.updatedAt).localeCompare(a.submittedAt ?? a.updatedAt);

function historyStatusLabel(d: Dcr) {
  const status = dcrBucket(d);
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  if (status === 'locked') return 'Locked';
  if (status === 'pending') return 'Pending';
  return 'Submitted';
}

/** Keep ?tab=history and ?view=<id> in the address bar so a reload or shared link lands here. */
function setUrl(view: string | null) {
  const u = new URL(window.location.href);
  for (const k of ['draft', 'new', 'view']) u.searchParams.delete(k);
  u.searchParams.set('tab', 'history');
  if (view) u.searchParams.set('view', view);
  window.history.replaceState(window.history.state, '', u);
}

export function DcrHistory({
  today,
  active,
  wtName,
  placeName,
  submitted,
  viewId,
}: {
  today: string;
  /** The History tab is showing (loading starts the first time it is). */
  active: boolean;
  wtName: (id: string) => string | undefined;
  placeName: Map<string, string>;
  /** The report just submitted on the drafts tab: shown at once and highlighted. */
  submitted: Dcr | null;
  /** /dcr?view=<id>: open this report once the list is in. */
  viewId: string | null;
}) {
  const since = shiftDay(today, -HISTORY_WINDOW_DAYS);
  const [items, setItems] = useState<Map<string, Dcr>>(new Map());
  const [phases, setPhases] = useState<Phase[]>(() => [
    { key: 'current', from: since, cursor: null, done: false },
  ]);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [older, setOlder] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const phasesRef = useRef(phases);
  phasesRef.current = phases;
  const headerRef = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<string | null>(null);
  const linked = useRef(false);

  /** First page of every phase still open (initial), else the next page of the first open phase. */
  const run = useCallback(async (initial: boolean) => {
    const open = phasesRef.current.filter((p) => !p.done);
    const targets = initial ? open : open.slice(0, 1);
    if (!targets.length) return;
    setLoading(true);
    setError(null);
    try {
      await apiReady();
      const res = await Promise.all(
        targets.map((p) =>
          api.GET('/v1/dcrs', {
            params: {
              query: {
                mine: 'true',
                sort: '-date',
                limit: PAGE,
                ...(p.from ? { from: p.from } : {}),
                ...(p.to ? { to: p.to } : {}),
                ...(p.cursor ? { cursor: p.cursor } : {}),
              },
            },
          }),
        ),
      );
      const bad = res.find((r) => !r.data);
      if (bad) return setError(failureMessage(bad, 'Could not load your report history.'));
      setItems((m) => {
        const n = new Map(m);
        for (const r of res) for (const d of r.data!.items) if (isHistory(d)) n.set(d.id, d);
        return n;
      });
      const next = new Map(targets.map((p, i) => [p.key, res[i]!.data!.nextCursor] as const));
      setPhases((ps) =>
        ps.map((p) =>
          next.has(p.key) ? { ...p, cursor: next.get(p.key) ?? null, done: !next.get(p.key) } : p,
        ),
      );
    } catch (e) {
      setError(thrownMessage(e));
    } finally {
      setStarted(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !started && !loading) void run(true);
  }, [active, started, loading, run]);

  const showOlder = () => {
    const to = shiftDay(since, -1);
    const more: Phase[] = [{ key: 'older', to, cursor: null, done: false }];
    phasesRef.current = [...phasesRef.current, ...more];
    setPhases(phasesRef.current);
    setOlder(true);
    void run(true);
  };

  // Just submitted on the drafts tab: show it now (the list call may not have it yet) and point at it.
  useEffect(() => {
    if (!submitted) return;
    setItems((m) => new Map(m).set(submitted.id, submitted));
    setHighlight(submitted.id);
    setAnnounce(`Report for ${dateLabel(submitted.date)} submitted. It is in History now.`);
    focusTarget.current = `card:${submitted.id}`;
    const t = window.setTimeout(
      () => setHighlight((h) => (h === submitted.id ? null : h)),
      HIGHLIGHT_MS,
    );
    return () => window.clearTimeout(t);
  }, [submitted]);

  const expand = useCallback((d: Dcr) => {
    setClosing(false);
    setOpenId(d.id);
    focusTarget.current = 'header';
    setUrl(d.id);
  }, []);

  // /dcr?view=<id>: open it once the first page is in; fetch it when it is older than what is loaded.
  useEffect(() => {
    if (!viewId || linked.current || !started) return;
    linked.current = true;
    const hit = items.get(viewId);
    if (hit) return expand(hit);
    void (async () => {
      const r = await api
        .GET('/v1/dcrs/{id}', { params: { path: { id: viewId } } })
        .catch(() => null);
      const d = r?.data;
      if (d && isHistory(d)) {
        setItems((m) => new Map(m).set(d.id, d));
        expand(d);
      } else if (d?.status === 'draft')
        toast.info('That report is still a draft. Find it under Today & drafts.');
      else toast.error('Could not find that report. It may have been deleted.');
    })();
  }, [viewId, started, items, expand]);

  const collapse = () => {
    if (!openId || closing) return;
    focusTarget.current = `card:${openId}`;
    setClosing(true);
    setUrl(null);
  };
  const onClosed = useCallback(() => {
    setOpenId(null);
    setClosing(false);
  }, []);

  useLayoutEffect(() => {
    const t = focusTarget.current;
    if (!t || !active) return;
    if (t === 'header' && openId && !closing) {
      focusTarget.current = null;
      headerRef.current?.focus({ preventScroll: true });
      headerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (t.startsWith('card:') && !openId) {
      const el = document.querySelector<HTMLElement>(`[data-history-card="${t.slice(5)}"]`);
      if (!el) return;
      focusTarget.current = null;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  const list = useMemo(() => [...items.values()].sort(newestDay), [items]);
  const more = phases.some((p) => !p.done);
  const bodyId = 'dcr-history-report';

  return (
    <div className="flex flex-col gap-4" data-testid="dcr-history">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <h2 className="text-sm font-medium text-muted-foreground" id="dcr-history-h">
        {older ? 'Reports' : `Reports, last ${HISTORY_WINDOW_DAYS} days`}
        {list.length ? ` (${list.length}${more ? '+' : ''})` : ''}
      </h2>

      {!started || (loading && !list.length) ? (
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label="Loading your reports"
          data-testid="dcr-history-loading"
        >
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl opacity-60" />
        </div>
      ) : (
        <>
          {!list.length && !error && (
            <div
              className="af-fade flex flex-col items-start gap-1 rounded-xl border border-dashed p-5 text-sm"
              data-testid="dcr-history-empty"
            >
              <p className="font-medium">
                {older ? 'No reports yet' : `No reports in the last ${HISTORY_WINDOW_DAYS} days`}
              </p>
              <p className="text-muted-foreground">
                Submitted reports and their review status show up here, newest day first.
              </p>
            </div>
          )}
          <ul
            className="flex flex-col"
            aria-labelledby="dcr-history-h"
            data-testid="dcr-history-list"
          >
            {list.map((d) =>
              openId === d.id ? (
                <li key={d.id} className="pb-3">
                  <Reveal key={`open-${d.id}`} closing={closing} onClosed={onClosed}>
                    <div
                      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6"
                      data-testid="dcr-history-open"
                    >
                      <div className="-mx-2 -mt-2 flex items-center justify-between gap-3">
                        <button
                          ref={headerRef}
                          type="button"
                          aria-expanded={!closing}
                          aria-controls={bodyId}
                          onClick={collapse}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          data-testid="dcr-history-toggle"
                        >
                          <span className="truncate text-base font-semibold tracking-tight">
                            {historyStatusLabel(d)} · {dateLabel(d.date)}
                          </span>
                          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                            Collapse <ChevronUp className="size-4" aria-hidden />
                          </span>
                        </button>
                      </div>
                      <div id={bodyId}>
                        <DcrFlow key={d.id} initialDate={d.date} dateLocked reportId={d.id} />
                      </div>
                    </div>
                  </Reveal>
                </li>
              ) : (
                <li key={d.id} className="pb-3">
                  <HistoryCard
                    d={d}
                    summary={dcrSummary(d, wtName(d.workTypeId), placeName)}
                    controls={bodyId}
                    highlighted={highlight === d.id}
                    onOpen={() => expand(d)}
                  />
                </li>
              ),
            )}
          </ul>

          {error && (
            <div
              className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-danger-soft p-4 text-sm"
              role="alert"
              data-testid="dcr-history-error"
            >
              {error}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void run(!started || !list.length)}
              >
                <RotateCw aria-hidden /> Retry
              </Button>
            </div>
          )}

          {!error && (more || !older) && (
            <div className="flex justify-center">
              {more ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={loading}
                  onClick={() => void run(false)}
                  data-testid="dcr-history-more"
                >
                  {loading ? 'Loading…' : 'Load more'}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 text-muted-foreground"
                  disabled={loading}
                  onClick={showOlder}
                  data-testid="dcr-history-older"
                >
                  <History aria-hidden />{' '}
                  {loading ? 'Loading…' : `Show reports before ${dateLabel(since)}`}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HistoryCard({
  d,
  summary,
  controls,
  highlighted,
  onOpen,
}: {
  d: Dcr;
  summary: string;
  controls: string;
  highlighted: boolean;
  onOpen: () => void;
}) {
  const status = dcrBucket(d);
  const label = historyStatusLabel(d);
  const tone =
    status === 'approved'
      ? 'bg-success-soft text-success'
      : status === 'rejected'
        ? 'bg-danger-soft text-destructive'
        : status === 'locked'
          ? 'bg-muted text-muted-foreground'
          : 'bg-accent/10 text-teal-700';
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-1.5 shadow-xs',
        'transition-[border-color,box-shadow,background-color] duration-700 ease-(--ease-out) hover:border-foreground/20 motion-reduce:transition-none',
        highlighted &&
          'border-success/60 bg-success-soft/50 ring-2 ring-success/25 hover:border-success/60',
      )}
    >
      <button
        type="button"
        aria-expanded={false}
        aria-controls={controls}
        onClick={onOpen}
        data-history-card={d.id}
        data-testid="dcr-history-card"
        data-status={d.status}
        className={cn(
          'group flex w-full min-w-0 items-start gap-3 rounded-lg py-2.5 pr-1.5 pl-2.5 text-left outline-none',
          'transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-out)',
          'hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:active:scale-100',
        )}
      >
        <FileCheck2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tracking-tight">{dateLabel(d.date)}</span>
            <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', tone)}>{label}</span>
            {highlighted && (
              <span className="af-fade text-xs font-medium text-success">Just now</span>
            )}
          </span>
          <span className="text-sm text-muted-foreground">{summary}</span>
          {d.submittedAt && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Submitted {istLabel(d.submittedAt)}
            </span>
          )}
        </span>
        <span
          className="flex size-10 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-colors duration-(--duration-fast) group-hover:bg-muted group-hover:text-foreground"
          aria-hidden
        >
          <ChevronDown className="size-4" />
        </span>
      </button>
    </div>
  );
}
