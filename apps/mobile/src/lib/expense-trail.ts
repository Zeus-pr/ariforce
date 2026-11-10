/**
 * Approval trail steps (ported from apps/web components/expenses/approval-trail.tsx):
 * Submitted -> Level 1..N -> Paid. Uses approvalTrail (PR #93) when present, else derives
 * the steps from approvalStep and the rejection fields (older API).
 */
import type { ExpenseApprovalLevel, ExpenseStatus } from '@ariforce/contracts';

export type TrailStatus = 'pending' | 'approved' | 'rejected' | 'skipped' | 'waiting';
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
  paidBy?: { id: string; name: string } | null;
  approvalTrail?: ExpenseApprovalLevel[] | null;
  totalLevels?: number | null;
};
export type TrailStep = {
  key: string;
  label: string;
  who?: string;
  at?: string | null;
  status: TrailStatus;
  note?: string | null;
};

const DEFAULT_LEVELS = 2;

export function trailSteps(c: TrailClaim): TrailStep[] {
  const trail = Array.isArray(c.approvalTrail) && c.approvalTrail.length ? c.approvalTrail : null;
  // A short trail must not hide later levels the server says are configured.
  const levels = Math.max(trail?.length ?? 0, c.totalLevels ?? 0) || DEFAULT_LEVELS;
  const steps: TrailStep[] = [
    {
      key: 'submitted',
      label: 'Submitted',
      at: c.submittedAt,
      status: c.status !== 'draft' ? 'approved' : 'waiting',
    },
  ];
  for (let i = 1; i <= levels; i++) {
    const t = trail?.find((x) => x.level === i);
    let status: TrailStatus;
    let who: string | undefined;
    let at: string | null = null;
    let note: string | null = null;
    let role: string | null | undefined;
    if (t) {
      // Predicted later levels are pending with current=false: show them as waiting.
      status = t.status === 'pending' && !t.current ? 'waiting' : t.status;
      const person = t.decidedBy ?? t.approver;
      if (person) {
        who = person.name;
        role = person.role;
      } else if (t.status === 'approved') who = 'Auto-approved';
      at = t.decidedAt;
      note = t.rejectionReason ?? t.comment;
    } else if (c.status === 'approved' || c.status === 'paid') status = 'approved';
    else if (c.status === 'submitted') {
      const cur = c.approvalStep ?? 1;
      status = i < cur ? 'approved' : i === cur ? 'pending' : 'waiting';
    } else if (c.status === 'rejected') {
      status = i === 1 ? 'rejected' : 'waiting';
      if (i === 1) {
        who = c.rejectedBy?.name ?? who;
        at = c.rejectedAt ?? c.decidedAt ?? null;
        note = c.rejectionReason ?? c.decisionComment ?? null;
      }
    } else status = 'waiting';
    if (i === levels && !t && (c.status === 'approved' || c.status === 'paid'))
      at = at ?? c.decidedAt ?? null;
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
    who:
      [c.paidBy?.name, c.paymentRef && `Ref ${c.paymentRef}`].filter(Boolean).join(' · ') ||
      undefined,
    status: c.status === 'paid' ? 'approved' : c.status === 'approved' ? 'pending' : 'waiting',
  });
  return steps;
}

export const trailWhen = (t?: string | null) =>
  t
    ? new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(t))
    : null;
