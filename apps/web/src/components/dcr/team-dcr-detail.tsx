'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { Dcr } from '@ariforce/contracts';
import { Button } from '@ariforce/ui/components/button';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { toast } from '@ariforce/ui/components/sonner';
import { RejectDialog } from '@/components/approvals/reject-dialog';
import { dateLabel, timeIST } from '@/components/attendance/format';
import { useRole } from '@/components/shell/role-context';
import { api, apiReady } from '@/lib/api';
import { failureMessage } from '@/lib/dcr/errors';
import { draftsOf, expensesOf } from '@/lib/dcr/expenses';
import { can, money } from '@/lib/expenses/model';
import { useTeamPeople } from '@/lib/team/people';
import { calls as callsLabel, dcrSummary } from './dcr-card-parts';
import { DcrExpenses } from './dcr-expenses';

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
/** The IST calendar day of a timestamp (00:00 IST belongs to the new day). */
const istDay = (iso: string) => ymd.format(new Date(iso));
const at = (iso?: string | null) => (iso ? `${dateLabel(istDay(iso))}, ${timeIST(iso)}` : '');
const hm = (iso: string) => timeIST(iso).replace(' IST', '');

const STATUS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Waiting for review',
  locked: 'Locked',
  approved: 'Approved',
  rejected: 'Rejected',
};
const KIND: Record<string, string> = { doctor: 'Doctor', chemist: 'Chemist', stockist: 'Stockist' };
const noop = () => {};

/** Someone's report, read-only, opened from the team list: key facts first, then the day's work. */
export function TeamDcrDetail({ id }: { id: string }) {
  return (
    <>
      <Link
        href="/dcr?tab=team"
        className="flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Team DCRs
      </Link>
      <DcrReportBody id={id} />
    </>
  );
}

/** The report with Approve / Reject (reason) in place; `inline` is the compact form used on the Approvals page. */
export function DcrReportBody({
  id,
  inline = false,
  readOnly = false,
}: {
  id: string;
  inline?: boolean;
  readOnly?: boolean;
}) {
  const { role, user } = useRole();
  const people = useTeamPeople(role);
  const q = useQuery({
    queryKey: ['dcr', id],
    queryFn: async () => {
      await apiReady();
      const r = await api.GET('/v1/dcrs/{id}', { params: { path: { id } } });
      if (!r.data) throw new Error(failureMessage(r, 'Could not load this report.'));
      return r.data;
    },
  });
  const d = q.data;
  const nameOf = (uid: string) => people.data?.byId.get(uid)?.name;
  return (
    <>
      {q.error ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border p-4 text-sm">
          <p className="text-destructive">{(q.error as Error).message}</p>
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      ) : !d ? (
        <div className="flex flex-col gap-4" aria-busy>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-1">
            {inline ? (
              <h3 className="font-semibold">{nameOf(d.userId) ?? 'Team member'}</h3>
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight">
                {nameOf(d.userId) ?? 'Team member'}
              </h1>
            )}
            <p className="text-sm text-muted-foreground">
              {dateLabel(d.date)} ·{' '}
              {d.reviewStatus === 'pending' ? STATUS.submitted : (STATUS[d.status] ?? d.status)}
            </p>
          </header>
          {!readOnly &&
            d.reviewStatus === 'pending' &&
            d.userId !== user?.id &&
            can(role, 'dcr:review') && <ReviewBar id={d.id} onDone={() => void q.refetch()} />}
          <ReportFacts d={d} nameOf={nameOf} />
          <WorkDone d={d} />
          <DcrExpenses
            rows={draftsOf(expensesOf(d))}
            onChange={noop}
            readOnly
            defaultCategory={() => 'other'}
            showErrors={false}
          />
        </>
      )}
    </>
  );
}

/** Review, lock and expense facts. Plain text, no actions. */
function ReportFacts({ d, nameOf }: { d: Dcr; nameOf: (id: string) => string | undefined }) {
  const who = (uid?: string | null) => (uid ? (nameOf(uid) ?? 'Manager') : 'Manager');
  const rows: [string, string][] = [];
  if (d.submittedAt) rows.push(['Submitted', at(d.submittedAt)]);
  if (d.approvedAt)
    rows.push([
      'Approved',
      d.autoApproved || !d.approvedBy
        ? `Automatically, ${at(d.approvedAt)}`
        : `${who(d.approvedBy)}, ${at(d.approvedAt)}`,
    ]);
  if (d.rejectedAt) rows.push(['Rejected', `${who(d.rejectedBy)}, ${at(d.rejectedAt)}`]);
  if (d.rejectionReason) rows.push(['Reason', d.rejectionReason]);
  if (d.deviationReason) rows.push(['Change from plan', d.deviationReason]);
  if (d.neverLocks) rows.push(['Day lock', 'Never locks']);
  else if (d.lockAt)
    rows.push([
      'Day lock',
      `${Date.parse(d.lockAt) <= Date.now() ? 'Locked' : 'Locks'} ${at(d.lockAt)}`,
    ]);
  if (d.unlockedUntil && Date.parse(d.unlockedUntil) > Date.now())
    rows.push(['Open for correction until', at(d.unlockedUntil)]);
  if ((d.expenseCount ?? 0) > 0) rows.push(['Expenses', money(d.expenseTotal ?? 0)]);
  if (!rows.length) return null;
  return (
    <dl
      className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 rounded-xl border bg-card p-4 text-sm"
      data-testid="dcr-facts"
    >
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

type Details = {
  kind?: string;
  title?: string | null;
  taskType?: string | null;
  location?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationMin?: number | null;
  fromPlace?: string | null;
  toPlace?: string | null;
  remarks?: string | null;
};

/** What the day was: summary, meeting/office details, and the calls with names. */
function WorkDone({ d }: { d: Dcr }) {
  const det = (d.details ?? null) as Details | null;
  const names = useQuery({
    queryKey: ['dcr-outlet-names', d.id],
    enabled: d.calls.length > 0,
    queryFn: async () => {
      await apiReady();
      const by = (k: string) => [
        ...new Set(d.calls.filter((c) => c.outletKind === k).map((c) => c.outletId)),
      ];
      const m = new Map<string, string>();
      const load = async (
        path: '/v1/doctors' | '/v1/chemists' | '/v1/stockists',
        ids: string[],
      ) => {
        if (!ids.length) return;
        const r = await api.GET(path, { params: { query: { ids: ids.join(','), limit: 100 } } });
        for (const o of (r.data?.items ?? []) as { id: string; name: string }[])
          m.set(o.id, o.name);
      };
      await Promise.all([
        load('/v1/doctors', by('doctor')),
        load('/v1/chemists', by('chemist')),
        load('/v1/stockists', by('stockist')),
      ]);
      return m;
    },
  });
  const time =
    det?.startTime && det?.endTime
      ? `${det.startTime}–${det.endTime}`
      : (det?.startTime ?? det?.endTime ?? null);
  const facts = [
    time && (det?.durationMin ? `${time} · ${det.durationMin} min` : time),
    det?.fromPlace && det?.toPlace ? `${det.fromPlace} → ${det.toPlace}` : null,
    det?.location ?? null,
  ].filter(Boolean) as string[];
  const sorted = [...d.calls].sort((a, b) => a.calledAt.localeCompare(b.calledAt));
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        {d.details || !sorted.length
          ? dcrSummary(d, undefined, new Map())
          : callsLabel(sorted.length)}
      </h2>
      {det && (det.title || det.taskType || facts.length > 0 || det.remarks) && (
        <div className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-sm">
          {(det.title || det.taskType) && (
            <p className="font-medium">{det.title ?? det.taskType}</p>
          )}
          {facts.map((f) => (
            <p key={f} className="text-muted-foreground">
              {f}
            </p>
          ))}
          {det.remarks && <p>{det.remarks}</p>}
        </div>
      )}
      {sorted.length > 0 && (
        <ul
          className="divide-y rounded-lg border bg-card text-sm"
          aria-label={callsLabel(sorted.length)}
        >
          {sorted.map((c) => (
            <li key={c.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {names.data?.get(c.outletId) ?? (names.isLoading ? '…' : KIND[c.outletKind])}
                </span>
                <span className="text-muted-foreground">
                  {KIND[c.outletKind]}
                  {c.productsDetailed.length > 0 &&
                    ` · ${c.productsDetailed.length} product${c.productsDetailed.length === 1 ? '' : 's'}`}
                  {c.remarks ? ` · ${c.remarks}` : ''}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{hm(c.calledAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const REASON_MAX = 500;

/**
 * Approve or reject a submitted report (POST /v1/dcrs/{id}/decision, dcr:review). Who may act is
 * decided by the server: the owner's reporting line, the whole company for the Director.
 */
/** Approve / Reject (reason) for a submitted report; the server only blocks the submitter, not a past day. */
export function ReviewBar({ id, onDone }: { id: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const decide = useMutation({
    mutationFn: async (b: { decision: 'approve' } | { decision: 'reject'; comment: string }) => {
      await apiReady();
      const r = await api.POST('/v1/dcrs/{id}/decision', { params: { path: { id } }, body: b });
      if (!r.data) throw new Error(failureMessage(r, 'Could not save the decision.'));
      return b.decision;
    },
    onSuccess: (decision) => {
      toast.success(decision === 'approve' ? 'Report approved' : 'Report rejected');
      setRejecting(false);
      void qc.invalidateQueries({ queryKey: ['dcr'] });
      void qc.invalidateQueries({ queryKey: ['approvals-org'] });
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="dcr-review">
      <Button disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'approve' })}>
        Approve
      </Button>
      <Button variant="outline" disabled={decide.isPending} onClick={() => setRejecting(true)}>
        Reject
      </Button>
      <RejectDialog
        open={rejecting}
        title="Reject this report?"
        description="The rep can file a new report for the day. Say what to fix."
        busy={decide.isPending}
        onOpenChange={setRejecting}
        onConfirm={(reason) => {
          const comment = reason.trim();
          if (comment.length > REASON_MAX)
            return toast.error(`Keep the reason under ${REASON_MAX} characters.`);
          decide.mutate({ decision: 'reject', comment });
        }}
      />
    </div>
  );
}
