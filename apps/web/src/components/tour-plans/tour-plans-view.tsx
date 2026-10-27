'use client';

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
import { saveMessage } from '@/lib/leave/model';
import { isApprover } from '@/lib/roles';
import { ApprovalReview } from '@/components/approvals/approval-review';
import { RejectDialog } from '@/components/approvals/reject-dialog';
import { RejectionNote } from '@/components/approvals/rejection-note';
import { datesOf, dayLabel, monthLabel, shiftMonth, thisMonthIST, weekdayMon } from './month';

type Day = TourPlan['days'][number];
type Entry = Day['entries'][number];

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
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
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
  const month = useSyncExternalStore(noop, thisMonthIST, () => null);
  if (!month) return <div className="h-[640px]" aria-busy="true" />;
  return (
    <LookupsProvider>
      <Planner initialMonth={month} />
    </LookupsProvider>
  );
}

function Planner({ initialMonth }: { initialMonth: string }) {
  const { role } = useRole();
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
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvalsKey, setApprovalsKey] = useState(0);

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

  const dates = useMemo(() => datesOf(month), [month]);
  const byDate = useMemo(() => new Map((plan?.days ?? []).map((d) => [d.date, d])), [plan]);
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
  const canSubmit = !!plan && hasPlannedDay(plan.days) && chosen.length > 0;
  const subById = useMemo(
    () => new Map((plan?.submissions ?? []).map((x) => [x.id, x])),
    [plan],
  );
  const rejectionOf = (d: string) => {
    const day = byDate.get(d);
    return day?.status === 'rejected' && day.submissionId ? subById.get(day.submissionId) : undefined;
  };
  const notRequired = (d: string) =>
    required.has(d)
      ? null
      : c.weeklyOffDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())
        ? 'Weekly off'
        : d < today
          ? 'Past'
          : 'Not required';
  // #86: days lock one by one (submitted/approved); the rest of the month stays editable.
  const editable = !!plan;

  async function start(fromMonth?: string) {
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

  const wtName = useMemo(() => new Map(workTypes.map((w) => [w.id, w])), [workTypes]);
  const lead = weekdayMon(`${month}-01`);

  return (
    <div className="flex flex-col gap-6">
      {role && isApprover(role) && <ApprovalsPanel key={approvalsKey} onDecided={load} />}

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

        {plan === undefined ? (
          <div className="h-[480px] animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
        ) : plan === null ? (
          <div
            className="af-enter flex flex-col items-start gap-3 rounded-lg border p-6"
            data-testid="tp-empty"
          >
            <p className="font-medium">No plan for {monthLabel(month)} yet.</p>
            <p className="text-sm text-muted-foreground">
              Start from your standard tour plan, or copy last month and adjust.
            </p>
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
          </div>
        ) : (
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
                const wt = e[0] ? wtName.get(e[0].workTypeId) : undefined;
                const empty = e.length === 0;
                const nr = notRequired(date);
                const ds = dayStatus(date);
                const locked = !empty && isLocked(date);
                return (
                  <li key={date}>
                    <button
                      type="button"
                      data-testid="tp-day"
                      data-date={date}
                      data-empty={empty}
                      data-optional={nr ? nr.toLowerCase().replaceAll(' ', '-') : undefined}
                      data-status={empty ? undefined : ds}
                      disabled={!editable || locked}
                      title={locked ? `Locked: ${ds}` : undefined}
                      onClick={() => setEditing(date)}
                      aria-label={`${dayLabel(date)}: ${empty ? (nr ? `${nr.toLowerCase()}, not required` : 'not planned') : (wt?.name ?? 'planned')}`}
                      className={cn(
                        'flex min-h-14 w-full flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left text-sm transition-[transform,background-color] duration-150 active:scale-[0.98] disabled:cursor-default sm:min-h-20',
                        empty ? 'border-dashed' : 'bg-card',
                        empty && nr && 'border-transparent bg-muted/40',
                        editable && 'hover:bg-muted/60',
                      )}
                    >
                      <span className="text-xs tabular-nums text-muted-foreground">
                        <span className="sm:hidden">{dayLabel(date)}</span>
                        <span className="hidden sm:inline">{Number(date.slice(8))}</span>
                      </span>
                      {empty ? (
                        nr ? (
                          <span className="text-xs text-muted-foreground" data-testid="tp-optional">
                            {nr}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {editable ? 'Plan this day' : 'Not planned'}
                          </span>
                        )
                      ) : (
                        <>
                          <span className="font-medium leading-tight">{wt?.name ?? 'Planned'}</span>
                          <TerritoryNames ids={e[0]?.territoryIds ?? []} />
                          <span
                            className={cn('mt-0.5 rounded px-1.5 text-[11px] font-medium', DAY_STATUS[ds].tone)}
                            data-testid="tp-day-status"
                          >
                            {DAY_STATUS[ds].label}
                          </span>
                          {locked && (
                            <span className="text-[11px] text-muted-foreground" data-testid="tp-locked">
                              Locked: {ds}
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {plan && (
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
        onClose={() => setEditing(null)}
        onSave={async (date, entries) => {
          if (await saveDays(date === UNPLANNED ? missing : [date], entries)) setEditing(null);
        }}
      />
    </div>
  );
}

function TerritoryNames({ ids }: { ids: string[] }) {
  const { byId } = useLookups();
  if (!ids.length) return null;
  return (
    <span className="line-clamp-1 text-xs text-muted-foreground">
      {ids.map((i) => byId.get(i) ?? '…').join(', ')}
    </span>
  );
}

function DayEditor({
  date,
  title,
  entry,
  rejection,
  workTypes,
  onClose,
  onSave,
}: {
  date: string | null;
  title?: string;
  entry?: Entry;
  rejection?: Submission;
  workTypes: WorkType[];
  onClose: () => void;
  onSave: (date: string, entries: Entry[]) => Promise<void>;
}) {
  const { territories } = useLookups();
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
  const leaves = territories.filter((t) => !territories.some((c) => c.parentId === t.id));

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
          <DialogDescription>What you plan to do, and where.</DialogDescription>
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
            <Select value={wt} onValueChange={setWt}>
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
              <Select value={terr} onValueChange={setTerr}>
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
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {needsTerritory && terr && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Doctors to visit <span className="font-normal text-muted-foreground">({docs.length} chosen)</span></span>
                <OutletPicker kind="doctor" territoryId={terr} value={docs} onChange={(ids) => setDocs(ids)} multiple testId="tp-doctors" />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Chemists to visit <span className="font-normal text-muted-foreground">({chems.length} chosen)</span></span>
                <OutletPicker kind="chemist" territoryId={terr} value={chems} onChange={(ids) => setChems(ids)} multiple testId="tp-chemists" />
              </div>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
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

  async function decide(a: Approval, decision: 'approve' | 'reject', note?: string) {
    const r = await api.POST('/v1/approvals/{id}/decision', {
      params: { path: { id: a.id } },
      body: decision === 'approve' ? { decision } : { decision, comment: note },
    });
    if (r.error) return toast.error(toApiError(r).message);
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
                <Button size="sm" variant="outline" onClick={() => setRejecting(a)} data-testid="tp-reject">
                  Reject
                </Button>
                <Button size="sm" onClick={() => decide(a, 'approve')} data-testid="tp-approve">
                  Approve
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
          <li key={x.id} className="flex flex-col gap-1 px-3 py-2.5 text-sm" data-testid="tp-submission" data-status={x.status}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded px-2 py-0.5 text-xs font-medium', DAY_STATUS[x.status].tone)}>
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
