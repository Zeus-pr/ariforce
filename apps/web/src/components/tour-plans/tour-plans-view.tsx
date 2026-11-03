'use client';

import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  requiredDates,
  istDate,
  DEFAULT_WEEKLY_OFF_DAYS,
  hasPlannedDay,
  type Approval,
  type TourPlan,
  type WorkType,
} from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ariforce/ui/components/dialog';
import { Label } from '@ariforce/ui/components/label';
import { EmptyOptions } from '@/components/forms/empty-options';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { OutletPicker } from '@/components/pickers/pickers';
import { LookupsProvider, useLookups } from '@/components/masters/lookups';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady, toApiError } from '@/lib/api';
import { approvalDecisionMessage, saveMessage } from '@/lib/leave/model';
import { thrownMessage } from '@/lib/dcr/errors';
import { isApprover } from '@/lib/roles';
import { ApprovalReview } from '@/components/approvals/approval-review';
import { RejectDialog } from '@/components/approvals/reject-dialog';
import { RejectionNote } from '@/components/approvals/rejection-note';
import { TourPlanItemApprovals } from './tour-plan-item-approvals';
import { datesOf, dayLabel, monthLabel, shiftMonth, thisMonthIST, weekdayMon } from './month';
import { territoryLabel, workTerritories } from '@/lib/territories';
import {
  monthNameOf,
  nextYmOf,
  tpFutureMonthCutoffError,
  tpMonthNotPlannable,
  tpOpenMonth,
} from '@/lib/tour-plans/cutoff';
import { fetchMyTourPlanItems, type TpItem } from '@/lib/tour-plans/items';

// 790-line editor dialog: loaded on its own chunk, after the page.
const TourPlanItemEditor = dynamic(
  () => import('./tour-plan-item-editor').then((m) => m.TourPlanItemEditor),
  { ssr: false },
);

type Day = TourPlan['days'][number];
type Entry = Day['entries'][number];

function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function tpStatusOf(status: TpItem['status']): DayStatus {
  return status === 'pending' ? 'submitted' : status;
}

const STATUS: Record<TourPlan['status'], { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-muted text-foreground' },
  submitted: { label: 'Waiting for approval', tone: 'bg-accent/10 text-teal-700' },
  approved: { label: 'Approved', tone: 'bg-success/10 text-success' },
  rejected: { label: 'Sent back', tone: 'bg-destructive/10 text-destructive' },
  recalled: { label: 'Recalled', tone: 'bg-muted text-foreground' },
};
type DayStatus = NonNullable<Day['status']>;
type Submission = NonNullable<TourPlan['submissions']>[number];
const DAY_STATUS: Record<DayStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-muted text-foreground' },
  submitted: { label: 'Submitted', tone: 'bg-accent/10 text-teal-700' },
  approved: { label: 'Approved', tone: 'bg-success/10 text-success' },
  rejected: { label: 'Rejected', tone: 'bg-destructive/10 text-destructive' },
};
const LOCKED: DayStatus[] = ['submitted', 'approved'];
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
// 409 DAY_LOCKED lists the dates that are already submitted or approved.
function lockedMessage(e: { code: string; message: string; details?: unknown }) {
  if (e.code === 'EMPTY_PLAN')
    return 'Nothing to submit. Plan at least one day that is not already submitted or approved.';
  if (e.code !== 'DAY_LOCKED') return null;
  const dates = (e.details as { dates?: string[] } | undefined)?.dates ?? [];
  return dates.length
    ? `These days are already submitted or approved and can’t be changed: ${dates.map(shortDate).join(', ')}.`
    : e.message;
}
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const noop = () => () => {};
const UNPLANNED = 'unplanned';

export function TourPlansView() {
  const current = useSyncExternalStore(noop, thisMonthIST, () => null);
  if (!current) return <div className="h-[640px]" aria-busy="true" />;
  // Default to the open next-month window; if closed, still land on next month (read-only).
  const initial = tpOpenMonth() ?? nextYmOf(current);
  return (
    <LookupsProvider>
      <Planner initialMonth={initial} />
    </LookupsProvider>
  );
}

function Planner({ initialMonth }: { initialMonth: string }) {
  const { role } = useRole();
  const { byId } = useLookups();
  const [month, setMonth] = useState(initialMonth);
  // Deep link from a notification: /tour-plans?plan=<id> opens that plan's month.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('plan');
    if (!id) return;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/tour-plans/{month}', { params: { path: { month: id } } });
      if (r.data?.month) setMonth(r.data.month);
    })().catch(() => {});
  }, []);
  const [plan, setPlan] = useState<TourPlan | null | undefined>(undefined);
  const [tpItems, setTpItems] = useState<TpItem[]>([]);
  const [tpItemsError, setTpItemsError] = useState<string | null>(null);
  const [selectedTp, setSelectedTp] = useState<TpItem | null>(null);
  const [selectedTpDate, setSelectedTpDate] = useState<string | null>(null);
  const [outletNames, setOutletNames] = useState<Map<string, string>>(new Map());
  const [outletNamesError, setOutletNamesError] = useState<string | null>(null);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvalsKey, setApprovalsKey] = useState(0);
  const [tpItemsReload, setTpItemsReload] = useState(0);

  const load = useCallback(async () => {
    setPlan(undefined);
    await apiReady();
    const r = await api.GET('/v1/tour-plans/{month}', { params: { path: { month } } });
    setPlan(r.data ?? null);
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);
  const [cal, setCal] = useState<{
    month: string;
    todayIST: string;
    weeklyOffDays: number[];
    requiredDates: string[];
  } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/tour-plans/{month}/calendar', { params: { path: { month } } });
      if (live) setCal(Array.isArray(r.data?.requiredDates) ? { ...r.data, month } : null);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [month]);
  useEffect(() => {
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/work-types', { params: { query: { limit: 100 } } });
      if (r.data) setWorkTypes(r.data.items.filter((w) => w.active));
    })().catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      const all = await fetchMyTourPlanItems();
      if (live) {
        setTpItems(all);
        setTpItemsError(null);
      }
    })().catch((error: unknown) => {
      if (live) setTpItemsError(thrownMessage(error));
    });
    return () => {
      live = false;
    };
  }, [tpItemsReload]);

  const dates = useMemo(() => datesOf(month), [month]);
  const byDate = useMemo(() => new Map((plan?.days ?? []).map((d) => [d.date, d])), [plan]);
  const { doctorIds, chemistIds } = useMemo(() => {
    const doctors = new Set<string>();
    const chemists = new Set<string>();
    for (const day of plan?.days ?? []) {
      for (const entry of day.entries) {
        entry.plannedDoctorIds?.forEach((id) => doctors.add(id));
        entry.plannedChemistIds?.forEach((id) => chemists.add(id));
      }
    }
    return { doctorIds: [...doctors], chemistIds: [...chemists] };
  }, [plan]);
  useEffect(() => {
    let live = true;
    setOutletNames(new Map());
    setOutletNamesError(null);
    if (!doctorIds.length && !chemistIds.length) return;
    void (async () => {
      await apiReady();
      const found = new Map<string, string>();
      const chunks = (ids: string[]) =>
        Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
          ids.slice(i * 100, (i + 1) * 100),
        );
      const [doctors, chemists] = await Promise.all([
        Promise.all(
          chunks(doctorIds).map((ids) =>
            api.GET('/v1/doctors', { params: { query: { ids: ids.join(','), limit: 100 } } }),
          ),
        ),
        Promise.all(
          chunks(chemistIds).map((ids) =>
            api.GET('/v1/chemists', { params: { query: { ids: ids.join(','), limit: 100 } } }),
          ),
        ),
      ]);
      for (const result of [...doctors, ...chemists]) {
        if (!result.data) throw new Error(toApiError(result).message);
        result.data.items.forEach((item) => found.set(item.id, item.name));
      }
      if (live) setOutletNames(found);
    })().catch((error: unknown) => {
      if (live) setOutletNamesError(thrownMessage(error));
    });
    return () => {
      live = false;
    };
  }, [doctorIds, chemistIds]);
  const tpByDate = useMemo(() => {
    const map = new Map<string, TpItem[]>();
    for (const item of tpItems) {
      for (const date of datesInRange(item.from, item.to)) {
        if (!date.startsWith(month)) continue;
        map.set(date, [...(map.get(date) ?? []), item]);
      }
    }
    return map;
  }, [tpItems, month]);
  // Required dates come from the server (GET /v1/tour-plans/{month}/calendar): today (IST) onward and
  // not a weekly off. If that endpoint is unavailable, apply the same rule on the client.
  const fallback = { todayIST: istDate(), weeklyOffDays: DEFAULT_WEEKLY_OFF_DAYS };
  const c =
    cal?.month === month
      ? cal
      : {
          ...fallback,
          requiredDates: requiredDates(month, fallback.todayIST, fallback.weeklyOffDays),
        };
  const today = c.todayIST;
  const required = useMemo(() => new Set(c.requiredDates), [c.requiredDates]);
  const monthBlocked = tpMonthNotPlannable(month);
  const monthBlockReason = tpFutureMonthCutoffError(month);
  const openMonth = tpOpenMonth();
  // Fill helper targets: unplanned working days (weekly offs and, this month, past days skipped).
  const missing = dates.filter((d) => required.has(d) && !byDate.get(d)?.entries.length);
  // Submit needs at least one planned day; full coverage is not required.
  const plannedCount = dates.filter((d) => byDate.get(d)?.entries.length).length;
  const dayStatus = (d: string): DayStatus => byDate.get(d)?.status ?? 'draft';
  const isLocked = (d: string) => LOCKED.includes(dayStatus(d));
  // Days that can go for approval now: planned and draft or rejected.
  const submittable = dates.filter((d) => byDate.get(d)?.entries.length && !isLocked(d));
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => setPicked(null), [month, plan?.version, plan?.status]);
  const selected = picked ?? new Set(submittable);
  const chosen = submittable.filter((d) => selected.has(d));
  const canSubmit = !!plan && !monthBlocked && hasPlannedDay(plan.days) && chosen.length > 0;
  const subById = useMemo(() => new Map((plan?.submissions ?? []).map((x) => [x.id, x])), [plan]);
  const rejectionOf = (d: string) => {
    const day = byDate.get(d);
    return day?.status === 'rejected' && day.submissionId
      ? subById.get(day.submissionId)
      : undefined;
  };
  const notRequired = (d: string) =>
    required.has(d)
      ? null
      : c.weeklyOffDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())
        ? 'Weekly off'
        : d < today
          ? 'Past'
          : 'Not required';
  // Next-month window only: outside that month the calendar is view-only (empty days greyed).
  const editable = !!plan && !monthBlocked;

  async function start(fromMonth?: string) {
    if (monthBlocked) {
      toast.error(monthBlockReason ?? 'This month is not open for planning.', { duration: 10000 });
      return;
    }
    setBusy(true);
    const r = await api.POST('/v1/tour-plans/{month}/copy', {
      params: { path: { month } },
      body: fromMonth ? { fromMonth, fromStp: false } : { fromStp: true },
    });
    if (r.error && !fromMonth && r.response.status === 404) {
      // No standard tour plan saved yet: start a blank draft instead of failing.
      const blank = await api.PUT('/v1/tour-plans/{month}', {
        params: { path: { month } },
        body: { days: [] },
      });
      setBusy(false);
      if (blank.error) return toast.error(toApiError(blank).message);
      toast.info('No standard plan saved yet, so this month starts blank.');
      return setPlan(blank.data);
    }
    setBusy(false);
    if (r.error) {
      // Only failure is 422 EMPTY_PLAN (no day has an entry); show the server's message.
      return toast.error(toApiError(r).message, { duration: 10000 });
    }
    setPlan(r.data);
  }

  async function saveDays(targets: string[], entries: Entry[]) {
    if (!plan) return;
    if (monthBlocked) {
      toast.error(monthBlockReason ?? 'This month is not open for planning.', { duration: 10000 });
      return false;
    }
    const days = [...byDate.values()].filter((d) => !targets.includes(d.date));
    if (entries.length) for (const date of targets) days.push({ date, entries });
    days.sort((a, b) => a.date.localeCompare(b.date));
    const r = await api.PUT('/v1/tour-plans/{month}', {
      params: { path: { month } },
      body: { days, version: plan.version },
    });
    if (r.error) {
      const e = toApiError(r);
      toast.error(lockedMessage(e) ?? saveMessage(e), { duration: 10000 });
      if (e.code === 'DAY_LOCKED') void load();
      return false;
    }
    setPlan(r.data);
    return true;
  }

  async function submit() {
    if (monthBlocked) {
      toast.error(monthBlockReason ?? 'This month is not open for planning.', { duration: 10000 });
      return;
    }
    setBusy(true);
    const all = chosen.length === submittable.length;
    const body: { submitterNote?: string; dates?: string[] } = {};
    if (note.trim()) body.submitterNote = note.trim();
    // Default path: no dates = every planned draft or rejected day.
    if (!all) body.dates = chosen;
    const r = await api.POST('/v1/tour-plans/{month}/submit', {
      params: { path: { month } },
      body,
    });
    setBusy(false);
    if (r.error) {
      const e = toApiError(r);
      toast.error(lockedMessage(e) ?? e.message, { duration: 10000 });
      if (e.code === 'DAY_LOCKED') void load();
      return;
    }
    setPlan(r.data);
    setNote('');
    setApprovalsKey((k) => k + 1);
    toast.success(
      `${chosen.length} ${chosen.length === 1 ? 'day' : 'days'} of ${monthLabel(month)} sent for approval`,
    );
  }

  const lead = weekdayMon(`${month}-01`);

  return (
    <div className="flex flex-col gap-6">
      {role && isApprover(role) && (
        <>
          <TourPlanItemApprovals />
          <ApprovalsPanel key={approvalsKey} onDecided={load} />
        </>
      )}

      <section className="flex flex-col gap-4" aria-labelledby="tp-month">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <h2
              id="tp-month"
              className="min-w-40 text-center text-base font-semibold tabular-nums"
              data-testid="tp-month"
            >
              {monthLabel(month)}
            </h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          {plan && (
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS[plan.status].tone)}
                data-testid="tp-status"
              >
                {STATUS[plan.status].label}
              </span>
              {editable && (
                <>
                  <span
                    className="text-sm text-muted-foreground tabular-nums"
                    data-testid="tp-missing"
                  >
                    {plannedCount === 0
                      ? 'No days planned yet'
                      : `${plannedCount} ${plannedCount === 1 ? 'day' : 'days'} planned`}
                  </span>
                  {missing.length > 0 && (
                    <Button
                      variant="outline"
                      onClick={() => setEditing(UNPLANNED)}
                      data-testid="tp-fill"
                    >
                      Fill unplanned days
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {plan?.status === 'rejected' && (plan.rejectionReason ?? plan.decisionComment) && (
          <RejectionNote
            reason={(plan.rejectionReason ?? plan.decisionComment)!}
            byName={plan.rejectedBy?.name}
            at={plan.rejectedAt ?? plan.decidedAt}
            hint="Change the plan and submit it again."
          />
        )}

        {monthBlocked && (
          <div
            className="rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm"
            role="status"
            data-testid="tp-month-blocked"
          >
            <p className="font-medium">
              {openMonth
                ? `${monthNameOf(month)} isn’t open for planning`
                : `Tour plans for ${monthNameOf(nextYmOf(thisMonthIST()))} are closed`}
            </p>
            <p className="text-muted-foreground">
              {monthBlockReason}
              {openMonth ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="font-medium text-foreground underline underline-offset-2"
                    onClick={() => setMonth(openMonth)}
                    data-testid="tp-go-open-month"
                  >
                    Go to {monthNameOf(openMonth)}
                  </button>
                </>
              ) : null}
            </p>
          </div>
        )}

        {tpItemsError && (
          <div
            className="rounded-xl border border-destructive/40 bg-danger-soft p-4 text-sm"
            role="alert"
            data-testid="tp-items-error"
          >
            Tour-plan history could not be loaded: {tpItemsError}
          </div>
        )}
        {outletNamesError && (
          <div
            className="rounded-xl border border-destructive/40 bg-danger-soft p-4 text-sm"
            role="alert"
            data-testid="tp-outlet-names-error"
          >
            Doctor and chemist names could not be loaded: {outletNamesError}
          </div>
        )}

        {plan === undefined ? (
          <div className="h-[480px] animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
        ) : (
          <>
            {plan === null && (
              <div
                className="af-enter flex flex-col items-start gap-3 rounded-lg border p-6"
                data-testid="tp-empty"
              >
                <p className="font-medium">No plan for {monthLabel(month)} yet.</p>
                <p className="text-sm text-muted-foreground">
                  {monthBlocked
                    ? 'You can browse other months, but only the next calendar month can be planned (until the 22nd at 12:00 AM IST).'
                    : 'Start from your standard tour plan, or copy last month and adjust.'}
                </p>
                {!monthBlocked && (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => start()} disabled={busy} data-testid="tp-start">
                      Start from standard plan
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => start(shiftMonth(month, -1))}
                      disabled={busy}
                    >
                      Copy {monthLabel(shiftMonth(month, -1))}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="af-fade" data-testid="tp-calendar">
              <div
                className="hidden grid-cols-7 gap-px pb-1 text-xs font-medium text-muted-foreground sm:grid"
                aria-hidden
              >
                {WEEKDAYS.map((w) => (
                  <div key={w} className="px-2">
                    {w}
                  </div>
                ))}
              </div>
              <ol className="grid grid-cols-1 gap-2 sm:grid-cols-7 sm:gap-1.5">
                {Array.from({ length: lead }, (_, i) => (
                  <li key={`pad${i}`} aria-hidden className="hidden sm:block" />
                ))}
                {dates.map((date) => {
                  const e = byDate.get(date)?.entries ?? [];
                  const tpItems = tpByDate.get(date) ?? [];
                  const itemStatus = tpItems[0]?.status;
                  const territoryIds = tpItems.length
                    ? [...new Set(tpItems.flatMap((item) => item.plan.territoryIds))]
                    : [...new Set(e.flatMap((entry) => entry.territoryIds))];
                  const plannedOutletIds = e.flatMap((entry) => [
                    ...(entry.plannedDoctorIds ?? []),
                    ...(entry.plannedChemistIds ?? []),
                  ]);
                  const placeLabels = [
                    ...territoryIds.map((id) => byId.get(id)),
                    ...plannedOutletIds.map((id) => outletNames.get(id)),
                  ].filter((label): label is string => !!label);
                  const empty = e.length === 0 && tpItems.length === 0;
                  const nr = notRequired(date);
                  const ds: DayStatus = itemStatus ? tpStatusOf(itemStatus) : dayStatus(date);
                  const locked = !empty && isLocked(date);
                  // Grey empty days outside the open planning window (planned days stay viewable).
                  const greyed = empty && monthBlocked;
                  const dayDisabled = greyed || (!editable && empty);
                  return (
                    <li key={date}>
                      <button
                        type="button"
                        data-testid="tp-day"
                        data-date={date}
                        data-empty={empty}
                        data-optional={nr ? nr.toLowerCase().replaceAll(' ', '-') : undefined}
                        data-status={empty ? undefined : ds}
                        disabled={dayDisabled}
                        title={
                          greyed
                            ? (monthBlockReason ?? 'Not open for planning')
                            : locked
                              ? `Locked: ${ds}`
                              : undefined
                        }
                        onClick={() => {
                          if (monthBlocked && empty) return;
                          if (!editable && empty) return;
                          if (tpItems.length > 0 && e.length === 0) {
                            setSelectedTp(tpItems[0]!);
                            setSelectedTpDate(date);
                            return;
                          }
                          setSelectedTp(null);
                          setSelectedTpDate(date);
                        }}
                        aria-label={`${dayLabel(date)}: ${empty ? (nr ? `${nr.toLowerCase()}, not required` : 'not planned') : placeLabels.join(', ') || 'planned'}${greyed ? ', not available to plan' : ''}`}
                        className={cn(
                          'flex h-24 w-full flex-col items-start gap-0.5 overflow-hidden rounded-md border px-2 py-1.5 text-left text-sm transition-[transform,background-color] duration-150 active:scale-[0.98] disabled:cursor-default sm:h-24',
                          empty ? 'border-dashed' : 'bg-card',
                          empty && nr && 'border-transparent bg-muted/40',
                          greyed &&
                            'border-transparent bg-muted/50 text-muted-foreground opacity-60',
                          editable && !greyed && 'hover:bg-muted/60',
                        )}
                      >
                        <span className="text-xs tabular-nums text-muted-foreground">
                          <span className="sm:hidden">{dayLabel(date)}</span>
                          <span className="hidden sm:inline">{Number(date.slice(8))}</span>
                        </span>
                        {empty ? (
                          nr ? (
                            <span
                              className="text-xs text-muted-foreground"
                              data-testid="tp-optional"
                            >
                              {nr}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {greyed ? 'Not open' : editable ? 'Plan this day' : 'Not planned'}
                            </span>
                          )
                        ) : tpItems.length > 0 ? (
                          tpItems.map((item) => (
                            <span
                              key={item.id}
                              className="flex min-h-0 w-full flex-1 flex-col items-start gap-0.5"
                            >
                              <span className="line-clamp-2 min-h-0 text-xs font-medium leading-tight">
                                {placeLabels.length ? placeLabels.join(' · ') : 'Tour plan'}
                              </span>
                              <span
                                className={cn(
                                  'mt-auto rounded px-1.5 text-[10px] font-medium leading-4',
                                  DAY_STATUS[tpStatusOf(item.status)].tone,
                                )}
                              >
                                {item.status === 'pending'
                                  ? 'Pending'
                                  : item.status === 'rejected'
                                    ? 'Rejected'
                                    : item.status === 'approved'
                                      ? 'Approved'
                                      : 'Draft'}
                              </span>
                            </span>
                          ))
                        ) : e.length > 0 ? (
                          <>
                            <span className="line-clamp-2 min-h-0 text-xs font-medium leading-tight">
                              {placeLabels.length ? placeLabels.join(' · ') : 'Planned'}
                            </span>
                            <span
                              className={cn(
                                'mt-auto rounded px-1.5 text-[10px] font-medium leading-4',
                                DAY_STATUS[ds].tone,
                              )}
                              data-testid="tp-day-status"
                            >
                              {ds === 'submitted' ? 'Pending' : DAY_STATUS[ds].label}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            {greyed ? 'Not open' : editable ? 'Plan this day' : 'Not planned'}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            {plan !== undefined && (
              <TourPlanDaySections
                days={plan?.days.filter((day) => day.entries.length > 0) ?? []}
                items={tpItems}
                outletNames={outletNames}
                workTypes={workTypes}
                rejectionOf={rejectionOf}
                onOpen={setEditing}
                onOpenTp={setSelectedTp}
              />
            )}
          </>
        )}

        {plan && editable && (
          <SubmitPanel
            days={submittable}
            selected={selected}
            onToggle={(d, on) => {
              const n = new Set(selected);
              if (on) n.add(d);
              else n.delete(d);
              setPicked(n);
            }}
            note={note}
            onNote={setNote}
            busy={busy}
            canSubmit={canSubmit}
            all={chosen.length === submittable.length}
            count={chosen.length}
            onSubmit={submit}
            rejectionOf={rejectionOf}
          />
        )}
        {plan && !!plan.submissions?.length && <SubmissionsList items={plan.submissions} />}
      </section>

      <DayEditor
        date={editing}
        title={editing === UNPLANNED ? `Fill ${missing.length} unplanned days` : undefined}
        entry={editing && editing !== UNPLANNED ? byDate.get(editing)?.entries[0] : undefined}
        rejection={editing && editing !== UNPLANNED ? rejectionOf(editing) : undefined}
        workTypes={workTypes}
        readOnly={!editable || (editing !== null && editing !== UNPLANNED && isLocked(editing))}
        onClose={() => setEditing(null)}
        onSave={async (date, entries) => {
          if (await saveDays(date === UNPLANNED ? missing : [date], entries)) setEditing(null);
        }}
      />
      <TourPlanItemEditor
        date={selectedTpDate ?? selectedTp?.from ?? null}
        item={selectedTp}
        readOnly={monthBlocked}
        onClose={() => {
          setSelectedTp(null);
          setSelectedTpDate(null);
        }}
        onSaved={() => setTpItemsReload((key) => key + 1)}
      />
    </div>
  );
}

function TourPlanDaySections({
  days,
  items,
  outletNames,
  workTypes,
  rejectionOf,
  onOpen,
  onOpenTp,
}: {
  days: Day[];
  items: TpItem[];
  outletNames: Map<string, string>;
  workTypes: WorkType[];
  rejectionOf: (date: string) => Submission | undefined;
  onOpen: (date: string) => void;
  onOpenTp: (item: TpItem) => void;
}) {
  const { byId } = useLookups();
  const workTypeName = new Map(workTypes.map((workType) => [workType.id, workType.name]));
  const groups = [
    { status: 'approved', title: 'Approved Tour Plans' },
    { status: 'submitted', title: 'Pending Approval' },
    { status: 'rejected', title: 'Rejected / Needs Resubmission' },
    { status: 'draft', title: 'Drafts' },
  ] as const;

  return (
    <div className="flex flex-col gap-6" data-testid="tp-status-sections">
      {groups.map(({ status, title }) => {
        const matching = days.filter(
          (day) =>
            (day.status ?? 'draft') === status &&
            !items.some((item) => item.from <= day.date && item.to >= day.date),
        );
        const tpStatus = status === 'submitted' ? 'pending' : status;
        const itemsForStatus = items.filter((item) => item.status === tpStatus);
        if (!matching.length && !itemsForStatus.length) return null;
        const key: DayStatus = status;
        return (
          <section
            key={status}
            className="flex flex-col gap-2"
            aria-labelledby={`tp-sec-${status}`}
            data-testid={`tp-sec-${status}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 id={`tp-sec-${status}`} className="text-sm font-medium text-muted-foreground">
                {title}
              </h3>
              <span className="text-xs tabular-nums text-muted-foreground">
                {matching.length + itemsForStatus.length}{' '}
                {matching.length + itemsForStatus.length === 1 ? 'day' : 'days'}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {matching.map((day) => {
                const reason = rejectionOf(day.date)?.rejectionReason;
                const placeLabels = [
                  ...day.entries.flatMap((entry) => entry.territoryIds.map((id) => byId.get(id))),
                  ...day.entries.flatMap((entry) =>
                    [...(entry.plannedDoctorIds ?? []), ...(entry.plannedChemistIds ?? [])].map(
                      (id) => outletNames.get(id),
                    ),
                  ),
                ].filter((label): label is string => !!label);
                return (
                  <li key={day.date}>
                    <button
                      type="button"
                      onClick={() => onOpen(day.date)}
                      className="flex w-full min-w-0 flex-col items-start gap-1 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      data-testid="tp-status-day"
                      data-date={day.date}
                      data-status={key}
                    >
                      <span className="flex w-full flex-wrap items-center gap-2">
                        <span className="font-semibold tracking-tight">{dayLabel(day.date)}</span>
                        <span
                          className={cn(
                            'rounded-md px-2 py-0.5 text-xs font-medium',
                            DAY_STATUS[key].tone,
                          )}
                        >
                          {key === 'submitted' ? 'Pending' : DAY_STATUS[key].label}
                        </span>
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {placeLabels.length ? placeLabels.join(' · ') : 'Planned'}
                      </span>
                      {reason && <span className="text-sm text-destructive">{reason}</span>}
                    </button>
                  </li>
                );
              })}
              {itemsForStatus.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenTp(item)}
                    className="flex w-full min-w-0 flex-col items-start gap-1 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    data-testid="tp-status-item"
                    data-date={item.from}
                    data-status={item.status}
                  >
                    <span className="flex w-full flex-wrap items-center gap-2">
                      <span className="font-semibold tracking-tight">
                        {shortDate(item.from)}
                        {item.to !== item.from ? ` – ${shortDate(item.to)}` : ''}
                      </span>
                      <span
                        className={cn(
                          'rounded-md px-2 py-0.5 text-xs font-medium',
                          DAY_STATUS[tpStatusOf(item.status)].tone,
                        )}
                      >
                        {item.status === 'pending'
                          ? 'Pending'
                          : DAY_STATUS[tpStatusOf(item.status)].label}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {[
                        ...item.plan.territoryIds.map((id) => byId.get(id)),
                        workTypeName.get(item.plan.workTypeId),
                      ]
                        .filter((name): name is string => !!name)
                        .join(' · ') || 'Tour plan'}
                    </span>
                    {item.status === 'rejected' && item.rejectionReason && (
                      <span className="text-sm text-destructive">{item.rejectionReason}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function DayEditor({
  date,
  title,
  entry,
  rejection,
  workTypes,
  readOnly = false,
  onClose,
  onSave,
}: {
  date: string | null;
  title?: string;
  entry?: Entry;
  rejection?: Submission;
  workTypes: WorkType[];
  readOnly?: boolean;
  onClose: () => void;
  onSave: (date: string, entries: Entry[]) => Promise<void>;
}) {
  const { territories, byId } = useLookups();
  const [wt, setWt] = useState('');
  const [terr, setTerr] = useState('');
  const [docs, setDocs] = useState<string[]>([]);
  const [chems, setChems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setWt(entry?.workTypeId ?? '');
    setTerr(entry?.territoryIds[0] ?? '');
    setDocs(entry?.plannedDoctorIds ?? []);
    setChems(entry?.plannedChemistIds ?? []);
  }, [entry, date]);
  const kind = workTypes.find((w) => w.id === wt)?.kind;
  const needsTerritory = kind === 'field';
  const leaves = workTerritories(territories);

  async function save(entries: Entry[]) {
    if (!date) return;
    setSaving(true);
    await onSave(date, entries);
    setSaving(false);
  }

  return (
    <Dialog open={!!date} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="tp-editor">
        <DialogHeader>
          <DialogTitle>{title ?? (date ? dayLabel(date) : '')}</DialogTitle>
          <DialogDescription>
            {readOnly ? 'This day can’t be edited right now.' : 'What you plan to do, and where.'}
          </DialogDescription>
        </DialogHeader>
        {rejection && (
          <RejectionNote
            reason={rejection.rejectionReason ?? rejection.decisionComment ?? 'No reason given'}
            byName={rejection.rejectedBy?.name ?? rejection.decidedBy?.name}
            at={rejection.rejectedAt ?? rejection.decidedAt}
            hint="Change this day and submit it again."
          />
        )}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tp-wt">Work type</Label>
            <Select value={wt} onValueChange={setWt} disabled={readOnly}>
              <SelectTrigger id="tp-wt" className="w-full" data-testid="tp-wt">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {workTypes.length === 0 && (
                  <EmptyOptions>No work types are set up yet. Ask your administrator.</EmptyOptions>
                )}
                {workTypes.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {needsTerritory && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tp-terr">Territory</Label>
              <Select value={terr} onValueChange={setTerr} disabled={readOnly}>
                <SelectTrigger id="tp-terr" className="w-full" data-testid="tp-terr">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {leaves.length === 0 && (
                    <EmptyOptions>
                      No territories are assigned to you yet. Ask your administrator.
                    </EmptyOptions>
                  )}
                  {leaves.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {territoryLabel(t, byId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {needsTerritory && terr && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">
                  Doctors to visit{' '}
                  <span className="font-normal text-muted-foreground">({docs.length} chosen)</span>
                </span>
                <OutletPicker
                  kind="doctor"
                  territoryId={terr}
                  value={docs}
                  onChange={(ids) => setDocs(ids)}
                  multiple
                  testId="tp-doctors"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">
                  Chemists to visit{' '}
                  <span className="font-normal text-muted-foreground">({chems.length} chosen)</span>
                </span>
                <OutletPicker
                  kind="chemist"
                  territoryId={terr}
                  value={chems}
                  onChange={(ids) => setChems(ids)}
                  multiple
                  testId="tp-chemists"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          {readOnly ? (
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              {entry && (
                <Button
                  variant="ghost"
                  className="sm:mr-auto"
                  disabled={saving}
                  onClick={() => save([])}
                >
                  Clear day
                </Button>
              )}
              <Button
                data-testid="tp-save"
                disabled={saving || !wt || (needsTerritory && !terr)}
                onClick={() =>
                  save([
                    {
                      session: 'full',
                      workTypeId: wt,
                      territoryIds: needsTerritory && terr ? [terr] : [],
                      jointWorkUserIds: entry?.jointWorkUserIds ?? [],
                      plannedDoctorIds: needsTerritory ? docs : [],
                      plannedChemistIds: needsTerritory ? chems : [],
                      notes: entry?.notes ?? null,
                    },
                  ])
                }
              >
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalsPanel({ onDecided }: { onDecided: () => void }) {
  const [items, setItems] = useState<Approval[] | null>(null);
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    await apiReady();
    const r = await api.GET('/v1/approvals', {
      params: {
        query: { subjectType: 'tour_plan', status: 'pending', mine: 'to_decide', limit: 50 },
      },
    });
    setItems(r.data?.items ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const [deciding, setDeciding] = useState<string | null>(null);
  async function decide(a: Approval, decision: 'approve' | 'reject', note?: string) {
    if (deciding) return;
    setDeciding(a.id);
    let r;
    try {
      r = await api.POST('/v1/approvals/{id}/decision', {
        params: { path: { id: a.id } },
        body: decision === 'approve' ? { decision } : { decision, comment: note },
      });
    } catch {
      return toast.error('Could not reach the server. Nothing was saved; try again.');
    } finally {
      setDeciding(null);
    }
    // LEAVE_DCR_CONFLICT: nothing saved, the approval stays pending in the list.
    if (r.error) return toast.error(approvalDecisionMessage(toApiError(r)), { duration: 10000 });
    toast.success(decision === 'approve' ? `${a.summary} approved` : `${a.summary} rejected`);
    setRejecting(null);
    await load();
    onDecided();
  }

  if (!items?.length) return null;
  return (
    <section
      className="af-enter flex flex-col gap-2"
      aria-labelledby="tp-approvals"
      data-testid="tp-approvals"
    >
      <h2 id="tp-approvals" className="text-base font-semibold">
        Waiting for your approval
      </h2>
      <ul className="divide-y rounded-lg border">
        {items.map((a) => (
          <li key={a.id} className="px-3 py-2.5" data-testid="tp-approval">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{a.summary}</p>
                <p className="text-xs text-muted-foreground">{a.requestedByName}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={openId === a.id}
                  onClick={() => setOpenId(openId === a.id ? null : a.id)}
                  data-testid="approval-view"
                >
                  {openId === a.id ? 'Hide plan' : 'View plan'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deciding !== null}
                  onClick={() => setRejecting(a)}
                  data-testid="tp-reject"
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  disabled={deciding !== null}
                  onClick={() => void decide(a, 'approve')}
                  data-testid="tp-approve"
                >
                  {deciding === a.id ? 'Approving…' : 'Approve'}
                </Button>
              </div>
            </div>
            {openId === a.id && <ApprovalReview approval={a} />}
          </li>
        ))}
      </ul>
      <RejectDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject ${rejecting?.summary ?? ''}`}
        description={`${rejecting?.requestedByName ?? ''} will see this reason.`}
        onConfirm={(reason) => rejecting && decide(rejecting, 'reject', reason)}
      />
    </section>
  );
}

function SubmitPanel(p: {
  days: string[];
  selected: Set<string>;
  onToggle: (d: string, on: boolean) => void;
  note: string;
  onNote: (v: string) => void;
  busy: boolean;
  canSubmit: boolean;
  all: boolean;
  count: number;
  onSubmit: () => void;
  rejectionOf: (d: string) => Submission | undefined;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4" data-testid="tp-submit-panel">
      <div>
        <h3 className="text-sm font-semibold">Send for approval</h3>
        <p className="text-sm text-muted-foreground">
          {p.days.length === 0
            ? 'Every planned day is already submitted or approved. Plan more days to submit them.'
            : 'Choose the days to send. Submitted and approved days are locked.'}
        </p>
      </div>
      {p.days.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-testid="tp-select-list">
          {p.days.map((d) => {
            const rej = p.rejectionOf(d);
            return (
              <li key={d}>
                <label className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={p.selected.has(d)}
                    onChange={(e) => p.onToggle(d, e.target.checked)}
                    data-testid="tp-select-day"
                    data-date={d}
                  />
                  {dayLabel(d)}
                  {rej && <span className="text-xs text-destructive">Rejected</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {p.days.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tp-note">Note for your approver (optional)</Label>
          <textarea
            id="tp-note"
            data-testid="tp-note"
            maxLength={1000}
            rows={2}
            value={p.note}
            onChange={(e) => p.onNote(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </div>
      )}
      <div>
        <Button
          onClick={p.onSubmit}
          disabled={p.busy || !p.canSubmit}
          title={!p.canSubmit ? 'Choose at least one planned day' : undefined}
          data-testid="tp-submit"
        >
          {p.all ? 'Submit for approval' : `Submit selected days (${p.count})`}
        </Button>
      </div>
    </div>
  );
}

const SUB_STATUS: Record<Submission['status'], string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

function SubmissionsList({ items }: { items: Submission[] }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="tp-subs" data-testid="tp-submissions">
      <h3 id="tp-subs" className="text-sm font-semibold">
        Submissions this month
      </h3>
      <ul className="divide-y rounded-lg border">
        {[...items].reverse().map((x) => (
          <li
            key={x.id}
            className="flex flex-col gap-1 px-3 py-2.5 text-sm"
            data-testid="tp-submission"
            data-status={x.status}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn('rounded px-2 py-0.5 text-xs font-medium', DAY_STATUS[x.status].tone)}
              >
                {SUB_STATUS[x.status]}
              </span>
              <span className="tabular-nums">{x.dates.map(shortDate).join(', ')}</span>
            </div>
            {x.submitterNote && (
              <p className="text-muted-foreground" data-testid="tp-submission-note">
                Your note: {x.submitterNote}
              </p>
            )}
            {x.status === 'rejected' ? (
              <p className="text-destructive" data-testid="tp-submission-reason">
                Rejected: {x.rejectionReason ?? x.decisionComment ?? 'No reason given'}
                {x.rejectedBy?.name ? `, by ${x.rejectedBy.name}` : ''}
                {x.rejectedAt ? `, ${shortDate(x.rejectedAt.slice(0, 10))}` : ''}
              </p>
            ) : (
              x.decisionComment && (
                <p className="text-muted-foreground" data-testid="tp-submission-comment">
                  Comment: {x.decisionComment}
                </p>
              )
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
