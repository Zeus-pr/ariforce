'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Approval, TourPlan, WorkType } from '@ariforce/contracts';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ariforce/ui/components/select';
import { toast } from '@ariforce/ui/components/sonner';
import { cn } from '@ariforce/ui/lib/utils';
import { LookupsProvider, useLookups } from '@/components/masters/lookups';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady, toApiError } from '@/lib/api';
import { isApprover } from '@/lib/roles';
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
const EDITABLE: TourPlan['status'][] = ['draft', 'rejected', 'recalled'];
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
  useEffect(() => {
    void (async () => {
      await apiReady();
      const r = await api.GET('/v1/work-types', { params: { query: { limit: 100 } } });
      if (r.data) setWorkTypes(r.data.items.filter((w) => w.active));
    })();
  }, []);

  const dates = useMemo(() => datesOf(month), [month]);
  const byDate = useMemo(() => new Map((plan?.days ?? []).map((d) => [d.date, d])), [plan]);
  const missing = dates.filter((d) => !byDate.get(d)?.entries.length);
  const editable = !!plan && EDITABLE.includes(plan.status);

  async function start(fromMonth?: string) {
    setBusy(true);
    const r = await api.POST('/v1/tour-plans/{month}/copy', {
      params: { path: { month } },
      body: fromMonth ? { fromMonth, fromStp: false } : { fromStp: true },
    });
    if (r.error && !fromMonth && r.response.status === 404) {
      // No standard tour plan saved yet: start a blank draft instead of failing.
      const blank = await api.PUT('/v1/tour-plans/{month}', { params: { path: { month } }, body: { days: [] } });
      setBusy(false);
      if (blank.error) return toast.error(toApiError(blank).message);
      toast.info('No standard plan saved yet, so this month starts blank.');
      return setPlan(blank.data);
    }
    setBusy(false);
    if (r.error) return toast.error(toApiError(r).message);
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
      toast.error(toApiError(r).message);
      return false;
    }
    setPlan(r.data);
    return true;
  }

  async function submit() {
    setBusy(true);
    const r = await api.POST('/v1/tour-plans/{month}/submit', { params: { path: { month } } });
    setBusy(false);
    if (r.error) return toast.error(toApiError(r).message);
    setPlan(r.data);
    setApprovalsKey((k) => k + 1);
    toast.success(`${monthLabel(month)} sent for approval`);
  }

  const wtName = useMemo(() => new Map(workTypes.map((w) => [w.id, w])), [workTypes]);
  const lead = weekdayMon(`${month}-01`);

  return (
    <div className="flex flex-col gap-6">
      {role && isApprover(role) && <ApprovalsPanel key={approvalsKey} onDecided={load} />}

      <section className="flex flex-col gap-4" aria-labelledby="tp-month">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft />
            </Button>
            <h2 id="tp-month" className="min-w-40 text-center text-base font-semibold tabular-nums" data-testid="tp-month">
              {monthLabel(month)}
            </h2>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight />
            </Button>
          </div>
          {plan && (
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS[plan.status].tone)} data-testid="tp-status">
                {STATUS[plan.status].label}
              </span>
              {editable && (
                <>
                  <span className="text-sm text-muted-foreground tabular-nums" data-testid="tp-missing">
                    {missing.length ? `${missing.length} of ${dates.length} days not planned` : 'Every day planned'}
                  </span>
                  {missing.length > 0 && missing.length < dates.length && (
                    <Button variant="outline" onClick={() => setEditing(UNPLANNED)} data-testid="tp-fill">
                      Fill unplanned days
                    </Button>
                  )}
                  <Button onClick={submit} disabled={busy || missing.length > 0} data-testid="tp-submit">
                    Submit for approval
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {plan?.status === 'rejected' && plan.decisionComment && (
          <p className="border-l-2 border-destructive pl-3 text-sm" role="note">
            <span className="font-medium">Manager&apos;s note:</span> {plan.decisionComment}
          </p>
        )}

        {plan === undefined ? (
          <div className="h-[480px] animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
        ) : plan === null ? (
          <div className="af-enter flex flex-col items-start gap-3 rounded-lg border p-6" data-testid="tp-empty">
            <p className="font-medium">No plan for {monthLabel(month)} yet.</p>
            <p className="text-sm text-muted-foreground">Start from your standard tour plan, or copy last month and adjust.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => start()} disabled={busy} data-testid="tp-start">Start from standard plan</Button>
              <Button variant="outline" onClick={() => start(shiftMonth(month, -1))} disabled={busy}>
                Copy {monthLabel(shiftMonth(month, -1))}
              </Button>
            </div>
          </div>
        ) : (
          <div className="af-fade" data-testid="tp-calendar">
            <div className="hidden grid-cols-7 gap-px pb-1 text-xs font-medium text-muted-foreground sm:grid" aria-hidden>
              {WEEKDAYS.map((w) => <div key={w} className="px-2">{w}</div>)}
            </div>
            <ol className="grid grid-cols-1 gap-2 sm:grid-cols-7 sm:gap-1.5">
              {Array.from({ length: lead }, (_, i) => <li key={`pad${i}`} aria-hidden className="hidden sm:block" />)}
              {dates.map((date) => {
                const e = byDate.get(date)?.entries ?? [];
                const wt = e[0] ? wtName.get(e[0].workTypeId) : undefined;
                const empty = e.length === 0;
                return (
                  <li key={date}>
                    <button
                      type="button"
                      data-testid="tp-day"
                      data-date={date}
                      data-empty={empty}
                      disabled={!editable}
                      onClick={() => setEditing(date)}
                      aria-label={`${dayLabel(date)}: ${empty ? 'not planned' : (wt?.name ?? 'planned')}`}
                      className={cn(
                        'flex min-h-14 w-full flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left text-sm transition-[transform,background-color] duration-150 active:scale-[0.98] disabled:cursor-default sm:min-h-20',
                        empty ? 'border-dashed' : 'bg-card',
                        editable && 'hover:bg-muted/60',
                      )}
                    >
                      <span className="text-xs tabular-nums text-muted-foreground">
                        <span className="sm:hidden">{dayLabel(date)}</span>
                        <span className="hidden sm:inline">{Number(date.slice(8))}</span>
                      </span>
                      {empty ? (
                        <span className="text-muted-foreground">{editable ? 'Plan this day' : 'Not planned'}</span>
                      ) : (
                        <>
                          <span className="font-medium leading-tight">{wt?.name ?? 'Planned'}</span>
                          <TerritoryNames ids={e[0]?.territoryIds ?? []} />
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </section>

      <DayEditor
        date={editing}
        title={editing === UNPLANNED ? `Fill ${missing.length} unplanned days` : undefined}
        entry={editing && editing !== UNPLANNED ? byDate.get(editing)?.entries[0] : undefined}
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
  return <span className="line-clamp-1 text-xs text-muted-foreground">{ids.map((i) => byId.get(i) ?? '…').join(', ')}</span>;
}

function DayEditor({
  date,
  title,
  entry,
  workTypes,
  onClose,
  onSave,
}: {
  date: string | null;
  title?: string;
  entry?: Entry;
  workTypes: WorkType[];
  onClose: () => void;
  onSave: (date: string, entries: Entry[]) => Promise<void>;
}) {
  const { territories } = useLookups();
  const [wt, setWt] = useState('');
  const [terr, setTerr] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setWt(entry?.workTypeId ?? '');
    setTerr(entry?.territoryIds[0] ?? '');
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
      <DialogContent data-testid="tp-editor">
        <DialogHeader>
          <DialogTitle>{title ?? (date ? dayLabel(date) : '')}</DialogTitle>
          <DialogDescription>What you plan to do, and where.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tp-wt">Work type</Label>
            <Select value={wt} onValueChange={setWt}>
              <SelectTrigger id="tp-wt" className="w-full" data-testid="tp-wt"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>
                {workTypes.length === 0 && <EmptyOptions>No work types set up yet. An admin can add them in Masters.</EmptyOptions>}
                {workTypes.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {needsTerritory && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tp-terr">Territory</Label>
              <Select value={terr} onValueChange={setTerr}>
                <SelectTrigger id="tp-terr" className="w-full" data-testid="tp-terr"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  {leaves.length === 0 && <EmptyOptions>No territories assigned to you yet.</EmptyOptions>}
                  {leaves.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {entry && (
            <Button variant="ghost" className="sm:mr-auto" disabled={saving} onClick={() => save([])}>Clear day</Button>
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
                  plannedDoctorIds: entry?.plannedDoctorIds ?? [],
                  plannedChemistIds: entry?.plannedChemistIds ?? [],
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
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    await apiReady();
    const r = await api.GET('/v1/approvals', { params: { query: { subjectType: 'tour_plan', status: 'pending', mine: 'to_decide', limit: 50 } } });
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
    toast.success(decision === 'approve' ? `${a.summary} approved` : `${a.summary} sent back`);
    setRejecting(null);
    setComment('');
    await load();
    onDecided();
  }

  if (!items?.length) return null;
  return (
    <section className="af-enter flex flex-col gap-2" aria-labelledby="tp-approvals" data-testid="tp-approvals">
      <h2 id="tp-approvals" className="text-base font-semibold">Waiting for your approval</h2>
      <ul className="divide-y rounded-lg border">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5" data-testid="tp-approval">
            <div>
              <p className="text-sm font-medium">{a.summary}</p>
              <p className="text-xs text-muted-foreground">{a.requestedByName}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setRejecting(a)}>Send back</Button>
              <Button size="sm" onClick={() => decide(a, 'approve')} data-testid="tp-approve">Approve</Button>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send back {rejecting?.summary}</DialogTitle>
            <DialogDescription>Say what needs to change. {rejecting?.requestedByName} will see this note.</DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-24 rounded-md border bg-background px-3 py-2 text-base md:text-sm"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-label="Note"
          />
          <DialogFooter>
            <Button disabled={!comment.trim()} onClick={() => rejecting && decide(rejecting, 'reject', comment.trim())}>
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
