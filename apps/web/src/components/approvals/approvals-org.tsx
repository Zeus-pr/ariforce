'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Approval } from '@ariforce/contracts';
import { Badge } from '@ariforce/ui/components/badge';
import { Skeleton } from '@ariforce/ui/components/skeleton';
import { ApprovalTrail, TrailDots, type TrailClaim } from '@/components/expenses/approval-trail';
import { EVERYONE, PersonPicker } from '@/components/team/person-picker';
import { api, apiReady } from '@/lib/api';
import { failureMessage } from '@/lib/dcr/errors';
import { ROLE_SHORT } from '@/lib/roles';
import { RANGE_LABEL, rangeOf, type RangeKey } from '@/lib/team/range';
import { todayIST } from '@/components/attendance/format';
import { ApprovalReview } from './approval-review';
import { SUBJECT_LABEL } from './approvals-queue';

type Status = Approval['status'] | 'all';
const STATUS: Record<Status, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  all: 'Any status',
};
const TYPES = ['all', 'tour_plan', 'dcr', 'dcr_unlock', 'leave', 'expense', 'signup'] as const;

const when = (t: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(t));

/** The approval as the shared trail component reads it (no Paid step). */
function asTrail(a: Approval): TrailClaim {
  return {
    status:
      a.status === 'pending' ? 'submitted' : a.status === 'approved' ? 'approved' : 'rejected',
    submittedAt: a.createdAt,
    decidedAt: a.decidedAt,
    decisionComment: a.comment,
    approvalTrail: a.trail ?? null,
    totalLevels: a.totalLevels ?? 1,
    approvalStep: a.level ?? null,
    paid: false,
  };
}

function stateLine(a: Approval) {
  if (a.status === 'pending')
    return a.currentApprover
      ? `Waiting on ${a.currentApprover.name}${a.totalLevels && a.totalLevels > 1 ? ` · level ${a.level ?? 1} of ${a.totalLevels}` : ''}`
      : 'Waiting';
  const last = a.trail?.filter((t) => t.decidedBy).at(-1)?.decidedBy?.name;
  return `${STATUS[a.status]}${last ? ` by ${last}` : ''}${a.decidedAt ? ` · ${when(a.decidedAt)}` : ''}`;
}

/**
 * Every approval in the company (GET /v1/approvals?scope=org, PR #128): filter by person, type,
 * status and period; each row shows who is holding it and expands to the level trail.
 */
export function OrgApprovals() {
  const [person, setPerson] = useState(EVERYONE);
  const [status, setStatus] = useState<Status>('pending');
  const [type, setType] = useState<(typeof TYPES)[number]>('all');
  const [range, setRange] = useState<RangeKey>('month');
  const [open, setOpen] = useState<string | null>(null);
  const { from, to } = rangeOf(range, todayIST());
  const q = useQuery({
    queryKey: ['approvals-org', person, status, type, from, to],
    queryFn: async () => {
      await apiReady();
      const r = await api.GET('/v1/approvals', {
        params: {
          query: {
            scope: 'org',
            include: 'dcr,signup',
            limit: 100,
            from,
            to,
            ...(person ? { userId: person } : {}),
            ...(status !== 'all' ? { status } : {}),
            ...(type !== 'all' && type !== 'dcr' && type !== 'signup' ? { subjectType: type } : {}),
          },
        },
      });
      if (!r.data) throw new Error(failureMessage(r, 'Could not load approvals.'));
      const items = r.data.items as Approval[];
      return type === 'dcr' || type === 'signup'
        ? items.filter((a) => a.subjectType === type)
        : items;
    },
  });

  const select = 'h-11 w-full rounded-md border bg-card px-3 text-sm md:h-9';
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[16rem_10rem_10rem_10rem]">
        <div className="col-span-2 sm:col-span-1">
          <PersonPicker value={person} onChange={setPerson} testId="approvals-person" />
        </div>
        <select
          aria-label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className={select}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'All types' : SUBJECT_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
          className={select}
        >
          {(Object.keys(STATUS) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Period"
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          className={`${select} col-span-2 sm:col-span-1`}
        >
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <option key={k} value={k}>
              {RANGE_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {q.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-danger-soft p-3 text-sm"
        >
          <span>{(q.error as Error).message}</span>
          <button type="button" className="shrink-0 underline" onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      ) : !q.data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : q.data.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No approvals match these filters.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card text-sm" data-testid="org-approvals">
          {q.data.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                aria-expanded={open === a.id}
                onClick={() => setOpen(open === a.id ? null : a.id)}
                className="flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted/50"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {a.requestedByName}
                    {a.requestedByRole && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        {ROLE_SHORT[a.requestedByRole]}
                      </span>
                    )}
                  </span>
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {SUBJECT_LABEL[a.subjectType] ?? a.subjectType}
                  </Badge>
                </span>
                <span className="truncate text-muted-foreground">{a.summary}</span>
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{stateLine(a)}</span>
                  <TrailDots claim={asTrail(a)} />
                </span>
              </button>
              {open === a.id && (
                <div className="flex flex-col gap-3 border-t px-4 py-4">
                  <ApprovalTrail claim={asTrail(a)} />
                  <ApprovalReview approval={a} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
