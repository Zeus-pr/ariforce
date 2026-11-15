import type { ExpenseApprovalLevel, ExpenseApprover } from '@ariforce/contracts';

/**
 * Per-level approval trail of an expense claim, derived from approval_requests + approval_steps
 * (no new columns). How levels are modelled: step 1 is created at submit for the requester's
 * manager; a step N+1 row is only inserted when step N is approved, N < levels and the current
 * approver has a manager who is not the requester and is not already covered by the decider. So
 * the request can finish early ("skipped ranks"): levels with no step row are then `skipped`.
 * While pending, levels after the current one are projected up the manager chain (`pending`,
 * not current) or `skipped` when nobody sits there.
 */
export interface TrailStep {
  stepNo: number;
  approverUserId: string | null;
  decision: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  comment: string | null;
}
export interface TrailRequest {
  state: string;
  currentStep: number;
  requestedBy: string;
}
export interface TrailUser {
  name: string;
  role: string | null;
  managerId: string | null;
}

const STATUS = (d: string): ExpenseApprovalLevel['status'] =>
  d === 'approved'
    ? 'approved'
    : d === 'rejected' || d === 'returned'
      ? 'rejected'
      : d === 'cancelled'
        ? 'skipped'
        : 'pending';

export function buildTrail(
  totalLevels: number,
  req: TrailRequest | null,
  steps: TrailStep[],
  users: Map<string, TrailUser>,
  finalApproverId: string | null = null,
): { approvalTrail: ExpenseApprovalLevel[]; currentApprover: ExpenseApprover | null } {
  if (!req) return { approvalTrail: [], currentApprover: null };
  const ref = (id: string | null): ExpenseApprover | null => {
    if (!id) return null;
    const u = users.get(id);
    return { id, name: u?.name ?? '', role: u?.role ?? null };
  };
  const byNo = new Map(steps.map((s) => [s.stepNo, s]));
  const n = Math.max(totalLevels, ...steps.map((s) => s.stepNo));
  const out: ExpenseApprovalLevel[] = [];
  let prevApprover: string | null = null;
  for (let level = 1; level <= n; level++) {
    const s = byNo.get(level);
    if (s) {
      const status = STATUS(s.decision);
      const current = req.state === 'pending' && level === req.currentStep && status === 'pending';
      out.push({
        level,
        approver: ref(s.approverUserId),
        decidedBy: ref(s.decidedBy),
        status,
        current,
        decidedAt: s.decidedAt?.toISOString() ?? null,
        comment: s.comment,
        rejectionReason: status === 'rejected' ? s.comment : null,
      });
      prevApprover = s.approverUserId;
      continue;
    }
    // No step row: projected while pending, otherwise the request finished before this level.
    let projected: string | null = null;
    if (req.state === 'pending' && prevApprover) {
      // finalApproverId: the last level is that person (the Director), not the next manager.
      const m: string | null =
        finalApproverId && level === totalLevels && level >= 3
          ? prevApprover === finalApproverId
            ? null
            : finalApproverId
          : (users.get(prevApprover)?.managerId ?? null);
      if (m && m !== req.requestedBy) projected = m;
    }
    out.push({
      level,
      approver: ref(projected),
      decidedBy: null,
      status: projected ? 'pending' : 'skipped',
      current: false,
      decidedAt: null,
      comment: null,
      rejectionReason: null,
    });
    prevApprover = projected;
  }
  return { approvalTrail: out, currentApprover: out.find((l) => l.current)?.approver ?? null };
}

/** Role shown for a user: the most senior of their roles (role_key enum order, admin last). */
const ORDER = [
  'director',
  'vice_president',
  'general_manager',
  'sales_manager',
  'zonal_business_manager',
  'regional_business_manager',
  'area_business_manager',
  'business_manager',
  'accountant',
  'distribution_head',
  'system_admin',
];
export const primaryRole = (keys: string[]) =>
  [...keys].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] ?? null;
