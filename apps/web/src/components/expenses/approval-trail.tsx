'use client';

import { Check, Clock, X } from 'lucide-react';
import type { ExpenseStatus } from '@ariforce/contracts';
import { cn } from '@ariforce/ui/lib/utils';

/**
 * Optional per-level trail. Not in the API contract yet (needs an additive field from Architect);
 * when the API starts returning it we use it, otherwise the trail is derived from the claim fields.
 */
export type TrailStatus = 'pending' | 'approved' | 'rejected' | 'skipped' | 'waiting';
export type ApprovalTrailItem = {
  level: number;
  approver?: { id: string; name: string; role?: string | null } | null;
  status: Exclude<TrailStatus, 'waiting'>;
  decidedAt?: string | null;
  comment?: string | null;
};
export type TrailClaim = {
  status: ExpenseStatus;
  approvalStep?: number | null;
  submittedAt?: string | null;
  decidedAt?: string | null;
  rejectionReason?: string | null;
  decisionComment?: string | null;
  rejectedBy?: { id: string; name: string } | null;
  rejectedAt?: string | null;
  paidAt?: string | null;
  paymentRef?: string | null;
  approvalTrail?: ApprovalTrailItem[] | null;
  totalLevels?: number | null;
};

const DEFAULT_LEVELS = 2;
type Step = {
  key: string;
  label: string;
  who?: string;
  at?: string | null;
  status: TrailStatus;
  note?: string | null;
};

const when = (t?: string | null) =>
  t
    ? new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(t))
    : null;

/** Steps: Submitted -> Level 1..N -> Paid. */
export function trailSteps(c: TrailClaim): Step[] {
  const trail = Array.isArray(c.approvalTrail) && c.approvalTrail.length ? c.approvalTrail : null;
  const levels = trail?.length ?? c.totalLevels ?? DEFAULT_LEVELS;
  const sent = c.status !== 'draft';
  const steps: Step[] = [
    {
      key: 'submitted',
      label: 'Submitted',
      at: c.submittedAt,
      status: sent ? 'approved' : 'waiting',
    },
  ];
  for (let i = 1; i <= levels; i++) {
    const t = trail?.find((x) => x.level === i);
    let status: TrailStatus;
    let who = t?.approver?.name ?? (i === 1 ? 'Manager' : `Level ${i} approver`);
    let at = t?.decidedAt ?? null;
    let note = t?.comment ?? null;
    if (t) status = t.status;
    else if (c.status === 'approved' || c.status === 'paid') status = 'approved';
    else if (c.status === 'submitted') {
      const cur = c.approvalStep ?? 1;
      status = i < cur ? 'approved' : i === cur ? 'pending' : 'waiting';
    } else if (c.status === 'rejected') {
      // The API names the rejector but not the level; show it on the first level unless the trail says otherwise.
      status = i === 1 ? 'rejected' : 'waiting';
      if (i === 1) {
        who = c.rejectedBy?.name ?? who;
        at = c.rejectedAt ?? c.decidedAt ?? null;
        note = c.rejectionReason ?? c.decisionComment ?? null;
      }
    } else status = 'waiting';
    if (i === levels && !t && (c.status === 'approved' || c.status === 'paid'))
      at = at ?? c.decidedAt ?? null;
    const role = t?.approver?.role;
    steps.push({
      key: `l${i}`,
      label: `Level ${i}`,
      who: role ? `${who} · ${role}` : who,
      at,
      status,
      note,
    });
  }
  steps.push({
    key: 'paid',
    label: 'Paid',
    at: c.paidAt,
    who: c.paymentRef ? `Ref ${c.paymentRef}` : undefined,
    status: c.status === 'paid' ? 'approved' : c.status === 'approved' ? 'pending' : 'waiting',
  });
  return steps;
}

const DOT: Record<TrailStatus, string> = {
  approved: 'bg-brand-600 text-white border-brand-600',
  pending: 'bg-teal-500 text-white border-teal-500 ring-4 ring-teal-100',
  rejected: 'bg-red-600 text-white border-red-600',
  skipped: 'bg-slate-100 text-slate-400 border-slate-200',
  waiting: 'bg-white text-slate-300 border-slate-200',
};

function Icon({ s }: { s: TrailStatus }) {
  if (s === 'approved') return <Check className="size-3.5" aria-hidden />;
  if (s === 'rejected') return <X className="size-3.5" aria-hidden />;
  if (s === 'pending') return <Clock className="size-3.5" aria-hidden />;
  return null;
}

/** Full trail for the claim page. */
export function ApprovalTrail({ claim }: { claim: TrailClaim }) {
  const steps = trailSteps(claim);
  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:gap-0" data-testid="exp-trail">
      {steps.map((s, i) => (
        <li
          key={s.key}
          className="relative flex flex-1 gap-3 pb-4 sm:flex-col sm:items-center sm:pb-0 sm:text-center"
          data-status={s.status}
          aria-current={s.status === 'pending' ? 'step' : undefined}
        >
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-7 left-3.5 h-[calc(100%-1.75rem)] w-0.5 sm:top-3.5 sm:left-[calc(50%+1rem)] sm:h-0.5 sm:w-[calc(100%-2rem)]',
                s.status === 'approved' ? 'bg-brand-600' : 'bg-slate-200',
              )}
            />
          )}
          <span
            className={cn(
              'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2',
              DOT[s.status],
            )}
          >
            <Icon s={s.status} />
          </span>
          <div className="min-w-0 sm:mt-2 sm:px-1">
            <p
              className={cn(
                'text-sm font-medium',
                s.status === 'pending' && 'text-teal-700',
                s.status === 'rejected' && 'text-red-700',
                s.status === 'waiting' && 'text-muted-foreground',
              )}
            >
              {s.label}
            </p>
            {s.who && <p className="truncate text-xs text-muted-foreground">{s.who}</p>}
            {s.at && <p className="text-xs text-muted-foreground tabular-nums">{when(s.at)}</p>}
            {s.status === 'rejected' && s.note && (
              <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">“{s.note}”</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Compact dots for list rows. */
export function TrailDots({ claim }: { claim: TrailClaim }) {
  const steps = trailSteps(claim);
  const pending = steps.find((s) => s.status === 'pending');
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label={pending ? `Waiting: ${pending.label}` : undefined}
      data-testid="exp-trail-dots"
    >
      {steps.map((s) => (
        <span
          key={s.key}
          className={cn(
            'size-2 rounded-full',
            s.status === 'approved' && 'bg-brand-600',
            s.status === 'pending' && 'bg-teal-500 ring-2 ring-teal-100',
            s.status === 'rejected' && 'bg-red-600',
            (s.status === 'waiting' || s.status === 'skipped') && 'bg-slate-200',
          )}
        />
      ))}
    </span>
  );
}
