'use client';

import { DcrReportBody } from '@/components/dcr/team-dcr-detail';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ActivityDay, CheckIn, TeamMemberActivity } from '@ariforce/contracts';
import { Input } from '@ariforce/ui/components/input';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ariforce/ui/components/tabs';
import { CheckInMap } from '@/components/attendance/check-in-map';
import { dateLabel, kindLabel, timeIST, todayIST } from '@/components/attendance/format';
import { ApprovalTrail, TrailDots, type TrailClaim } from '@/components/expenses/approval-trail';
import { StatusBadge } from '@/components/expenses/status-badge';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady } from '@/lib/api';
import { failureMessage } from '@/lib/dcr/errors';
import { money } from '@/lib/expenses/model';
import { useMemberActivity } from '@/lib/team/activity';
import { useTeamPeople } from '@/lib/team/people';
import { RANGE_LABEL, daysIn, monthsIn, rangeOf, type RangeKey } from '@/lib/team/range';

export type Tab = 'today' | 'dcrs' | 'plan' | 'attendance' | 'expenses' | 'leave' | 'performance';
const MAX_DAYS = 93;

const ATT: Record<ActivityDay['attendance'], string> = {
  present: 'Present',
  absent: 'Absent',
  leave: 'Leave',
  holiday: 'Holiday',
  incomplete: 'No punch-out',
  weekly_off: 'Weekly off',
};
const DCR: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Waiting for review',
  locked: 'Locked',
  approved: 'Approved',
  rejected: 'Rejected',
};
const hm = (iso: string | null) => (iso ? timeIST(iso).replace(' IST', '') : '—');

/**
 * Employee 360 tabs under the profile header: one range for every tab, a daily view on any row,
 * all from GET /v1/team/members/{id}/activity plus the existing leave, expense and TP endpoints.
 */
export function Member360({
  userId,
  canSeeExpenses,
  performance,
}: {
  userId: string;
  canSeeExpenses: boolean;
  performance: ReactNode;
}) {
  const today = todayIST();
  const [tab, setTab] = useState<Tab>('today');
  const [range, setRange] = useState<RangeKey | 'custom'>('week');
  const [custom, setCustom] = useState(() => rangeOf('week', today));
  const [day, setDay] = useState<string | null>(null);
  const { from, to } = range === 'custom' ? custom : rangeOf(range, today);
  const tooLong = daysIn(from, to) > MAX_DAYS || from > to;
  const ranged = tab !== 'today' && tab !== 'performance';
  const act = useMemberActivity(userId, from, to, ranged && tab !== 'leave' && !tooLong);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-w-0 gap-4">
      <div className="min-w-0 overflow-x-auto">
        <TabsList className="w-max">
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="dcrs">DCRs</TabsTrigger>
          <TabsTrigger value="plan">Plan vs actual</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          {canSeeExpenses && <TabsTrigger value="expenses">Expenses</TabsTrigger>}
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>
      </div>

      {ranged && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Period"
            value={range}
            onChange={(e) => {
              setRange(e.target.value as RangeKey | 'custom');
              setDay(null);
            }}
            className="h-9 rounded-md border bg-card px-3 text-sm"
          >
            {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
              <option key={k} value={k}>
                {RANGE_LABEL[k]}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
          {range === 'custom' && (
            <>
              <Input
                type="date"
                aria-label="From"
                value={custom.from}
                max={today}
                onChange={(e) =>
                  e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))
                }
                className="h-9 w-40"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="date"
                aria-label="To"
                value={custom.to}
                max={today}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
                className="h-9 w-40"
              />
            </>
          )}
          {tooLong && (
            <p role="alert" className="w-full text-sm text-destructive">
              Pick up to {MAX_DAYS} days, with the start before the end.
            </p>
          )}
        </div>
      )}

      <TabsContent value="today">
        <DayDetail userId={userId} date={today} />
      </TabsContent>
      <TabsContent value="dcrs">
        <WithActivity q={act} tooLong={tooLong}>
          {(a) => <DcrTab a={a} onDay={setDay} day={day} userId={userId} />}
        </WithActivity>
      </TabsContent>
      <TabsContent value="plan">
        <WithActivity q={act} tooLong={tooLong}>
          {(a) => <PlanTab a={a} onDay={setDay} day={day} userId={userId} />}
        </WithActivity>
      </TabsContent>
      <TabsContent value="attendance">
        <WithActivity q={act} tooLong={tooLong}>
          {(a) => <AttendanceTab a={a} onDay={setDay} day={day} userId={userId} />}
        </WithActivity>
      </TabsContent>
      {canSeeExpenses && (
        <TabsContent value="expenses">
          {!tooLong && <ExpensesTab userId={userId} from={from} to={to} />}
        </TabsContent>
      )}
      <TabsContent value="leave">
        {!tooLong && <LeaveTab userId={userId} from={from} to={to} />}
      </TabsContent>
      <TabsContent value="performance">{performance}</TabsContent>
    </Tabs>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-16" />
      <Skeleton className="h-48" />
    </div>
  );
}

function Failed({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-danger-soft p-3 text-sm"
    >
      <span>{message}</span>
      <button type="button" className="shrink-0 underline" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">{children}</p>
  );
}

function WithActivity({
  q,
  tooLong,
  children,
}: {
  q: ReturnType<typeof useMemberActivity>;
  tooLong: boolean;
  children: (a: TeamMemberActivity) => ReactNode;
}) {
  if (tooLong) return null;
  if (q.error)
    return <Failed message={(q.error as Error).message} retry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  return <>{children(q.data)}</>;
}

/** Key numbers for a range: few, large, scannable. */
function Totals({ items }: { items: [string, string | number][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-lg border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="text-lg font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

type DayProps = {
  a: TeamMemberActivity;
  day: string | null;
  onDay: (d: string | null) => void;
  userId: string;
};

/** Newest first; a row opens the daily view under it. */
function DayRows({
  a,
  day,
  onDay,
  userId,
  render,
}: DayProps & { render: (d: ActivityDay) => { main: ReactNode; side: ReactNode } }) {
  const days = [...a.days].reverse();
  if (!days.length) return <Empty>Nothing in this period.</Empty>;
  return (
    <ul className="divide-y rounded-lg border bg-card text-sm">
      {days.map((d) => {
        const r = render(d);
        const open = day === d.date;
        return (
          <li key={d.date}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onDay(open ? null : d.date)}
              className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block font-medium">{dateLabel(d.date)}</span>
                <span className="block truncate text-muted-foreground">{r.main}</span>
              </span>
              <span className="shrink-0 text-muted-foreground">{r.side}</span>
            </button>
            {open && (
              <div className="border-t bg-muted/20 p-4">
                <DayDetail userId={userId} date={d.date} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DcrTab(p: DayProps) {
  const t = p.a.totals;
  return (
    <div className="flex flex-col gap-4">
      <Totals
        items={[
          ['Reports', t.dcr.submitted + t.dcr.approved + t.dcr.locked + t.dcr.rejected],
          ['Approved', t.dcr.approved],
          ['Missing', t.dcr.missing],
          ['Calls', t.calls],
        ]}
      />
      <DayRows
        {...p}
        render={(d) => ({
          main: d.dcr
            ? [d.dcr.workTypeName, `${d.dcr.callCount} call${d.dcr.callCount === 1 ? '' : 's'}`]
                .concat(
                  d.dcr.expenses.length
                    ? [money(d.dcr.expenses.reduce((t, e) => t + e.amount, 0))]
                    : [],
                )
                .join(' · ')
            : ATT[d.attendance],
          side: d.dcr ? DCR[d.dcr.status] : 'No report',
        })}
      />
    </div>
  );
}

function PlanTab(p: DayProps) {
  const t = p.a.totals;
  const reported = p.a.days.filter((d) => d.dcr && d.dcr.status !== 'draft').length;
  const both = p.a.days.filter((d) => d.planned && d.dcr && d.dcr.status !== 'draft').length;
  return (
    <div className="flex flex-col gap-4">
      <Totals
        items={[
          ['Planned days', t.plannedDays],
          ['Reported days', reported],
          ['Planned and reported', both],
          ['Not planned', p.a.days.filter((d) => !d.planned && d.dcr).length],
        ]}
      />
      <DayRows
        {...p}
        render={(d) => ({
          main: `${d.planned ? 'Planned' : 'Not planned'} · ${d.dcr ? `${d.dcr.workTypeName}, ${d.dcr.callCount} calls` : 'no report'}`,
          side: d.planned && d.dcr ? 'Done' : d.planned ? 'Missed' : d.dcr ? 'Unplanned' : '—',
        })}
      />
    </div>
  );
}

function AttendanceTab(p: DayProps) {
  const t = p.a.totals;
  return (
    <div className="flex flex-col gap-4">
      <Totals
        items={[
          ['Present', t.present],
          ['Absent', t.absent],
          ['Leave', t.leave],
          ['GPS points', t.checkIns],
        ]}
      />
      <DayRows
        {...p}
        render={(d) => ({
          main: d.punchInAt
            ? `In ${hm(d.punchInAt)} · Out ${hm(d.punchOutAt)} · ${d.checkIns} GPS`
            : d.leave
              ? `${d.leave.typeCode}${d.leave.half ? ` (${d.leave.half.toUpperCase()})` : ''}`
              : '—',
          side: ATT[d.attendance],
        })}
      />
    </div>
  );
}

/** One day: attendance, report, calls and GPS points on the map. */
function DayDetail({ userId, date }: { userId: string; date: string }) {
  const q = useMemberActivity(userId, date, date);
  const [sel, setSel] = useState<string | null>(null);
  const placeOf = useMemo(() => {
    const byCheckIn = new Map(
      (q.data?.detail?.calls ?? []).map((c) => [c.checkInId, c.outletName]),
    );
    return (c: CheckIn) => byCheckIn.get(c.id) ?? kindLabel(c.kind);
  }, [q.data]);
  if (q.error)
    return <Failed message={(q.error as Error).message} retry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  const d = q.data.days[0];
  const calls = q.data.detail?.calls ?? [];
  const points = q.data.detail?.checkIns ?? [];
  if (!d) return <Empty>Nothing on this day.</Empty>;
  return (
    <div className="flex flex-col gap-4">
      <Totals
        items={[
          ['Attendance', ATT[d.attendance]],
          ['Punch in / out', d.punchInAt ? `${hm(d.punchInAt)} – ${hm(d.punchOutAt)}` : '—'],
          ['Report', d.dcr ? DCR[d.dcr.status]! : 'None'],
          ['Calls', d.calls],
        ]}
      />
      {d.dcr && <DcrReportBody id={d.dcr.id} inline readOnly />}
      {points.length > 0 && (
        <CheckInMap
          points={points}
          placeOf={placeOf}
          selectedId={sel}
          onSelect={setSel}
          className="h-[260px] sm:h-[340px]"
          label={`GPS points on ${dateLabel(date)}`}
        />
      )}
      {calls.length > 0 ? (
        <ul className="divide-y rounded-lg border bg-card text-sm" aria-label="Calls">
          {calls.map((c) => (
            <li key={c.id} className="flex items-baseline justify-between gap-3 px-4 py-2">
              <span className="min-w-0 truncate">
                {c.outletName ?? c.outletKind}
                <span className="ml-2 text-muted-foreground capitalize">{c.outletKind}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{hm(c.calledAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        !d.dcr && <Empty>No calls on this day.</Empty>
      )}
    </div>
  );
}

type Claim = TrailClaim & { id: string; month: string; total: number };

function ExpensesTab({ userId, from, to }: { userId: string; from: string; to: string }) {
  const months = monthsIn(from, to);
  const q = useQuery({
    queryKey: ['member-claims', userId, months.join(',')],
    queryFn: async () => {
      await apiReady();
      const all = await Promise.all(
        months.map((month) =>
          api.GET('/v1/expense-claims', {
            params: { query: { scope: 'team', userId, month, limit: 50 } },
          }),
        ),
      );
      const bad = all.find((r) => !r.data);
      if (bad) throw new Error(failureMessage(bad, 'Could not load expenses.'));
      return all.flatMap((r) => (r.data?.items ?? []) as unknown as Claim[]);
    },
  });
  const act = useMemberActivity(userId, from, to);
  const [open, setOpen] = useState<string | null>(null);
  if (q.error)
    return <Failed message={(q.error as Error).message} retry={() => void q.refetch()} />;
  if (act.error)
    return <Failed message={(act.error as Error).message} retry={() => void act.refetch()} />;
  if (!q.data || !act.data) return <Loading />;
  const reported = act.data.days.flatMap((d) =>
    d.dcr && d.dcr.expenses.length ? [{ date: d.date, dcr: d.dcr }] : [],
  );
  if (!q.data.length && !reported.length) return <Empty>No expenses in this period.</Empty>;
  const sum = (r: typeof reported) =>
    r.reduce((s, x) => s + x.dcr.expenses.reduce((t, e) => t + e.amount, 0), 0);
  const total = q.data.reduce((s, c) => s + c.total, 0);
  return (
    <div className="flex flex-col gap-4">
      <Totals
        items={[
          ['Reported on reports', money(sum(reported.filter((x) => x.dcr.status !== 'rejected')))],
          ['On rejected reports', money(sum(reported.filter((x) => x.dcr.status === 'rejected')))],
          ['Claims', q.data.length],
          ['Claimed total', money(total)],
        ]}
      />
      {reported.length > 0 && (
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {reported.map(({ date, dcr }) => (
            <li key={date} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{dateLabel(date)}</span>
                <span className="text-muted-foreground">{DCR[dcr.status]}</span>
              </div>
              <ul className="mt-1 space-y-0.5">
                {dcr.expenses.map((e, i) => (
                  <li key={i} className="flex justify-between gap-3 text-muted-foreground">
                    <span className="min-w-0 truncate capitalize">
                      {e.category}
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                    <span className={dcr.status === 'rejected' ? 'line-through' : ''}>
                      {money(e.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <ul className="divide-y rounded-lg border bg-card text-sm">
        {q.data.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-expanded={open === c.id}
              onClick={() => setOpen(open === c.id ? null : c.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block font-medium">
                  {new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(
                    new Date(`${c.month}-01T12:00:00Z`),
                  )}
                </span>
                <span className="block text-muted-foreground">{money(c.total)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <TrailDots claim={c} />
                <StatusBadge status={c.status} />
              </span>
            </button>
            {open === c.id && (
              <div className="border-t px-4 py-4">
                <ApprovalTrail claim={c} />
                <Link
                  href={`/expenses/${c.id}`}
                  className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Open claim
                </Link>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const LEAVE: Record<string, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

function LeaveTab({ userId, from, to }: { userId: string; from: string; to: string }) {
  const { role } = useRole();
  const people = useTeamPeople(role);
  const q = useQuery({
    queryKey: ['member-leave', userId, from, to],
    queryFn: async () => {
      await apiReady();
      const r = await api.GET('/v1/leave/requests', { params: { query: { userId, from, to } } });
      if (!r.data) throw new Error(failureMessage(r, 'Could not load leave.'));
      return r.data.items;
    },
  });
  if (q.error)
    return <Failed message={(q.error as Error).message} retry={() => void q.refetch()} />;
  if (!q.data) return <Loading />;
  if (!q.data.length) return <Empty>No leave in this period.</Empty>;
  const who = (v?: string | { name: string } | null) =>
    !v ? null : typeof v === 'string' ? (people.data?.byId.get(v)?.name ?? 'Manager') : v.name;
  return (
    <ul className="divide-y rounded-lg border bg-card text-sm">
      {q.data.map((l) => {
        const by = who(l.rejectedBy ?? l.decidedBy);
        return (
          <li key={l.id} className="flex flex-col gap-0.5 px-4 py-3">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                {l.typeName ?? l.typeCode} · {l.days} day{l.days === 1 ? '' : 's'}
              </span>
              <span className="shrink-0 text-muted-foreground">{LEAVE[l.status] ?? l.status}</span>
            </span>
            <span className="text-muted-foreground">
              {l.fromDate === l.toDate
                ? dateLabel(l.fromDate)
                : `${dateLabel(l.fromDate)} – ${dateLabel(l.toDate)}`}
              {by && l.status !== 'pending' ? ` · ${by}` : ''}
            </span>
            {(l.rejectionReason ?? l.decisionComment) && (
              <span>{l.rejectionReason ?? l.decisionComment}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
