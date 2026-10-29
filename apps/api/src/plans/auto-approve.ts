import type { Principal } from '../auth/principal';

/**
 * Directors have no manager (Sharanya 2026-10-29): what a director submits (DCR, tour plan, tour
 * plan item, expense claim, leave) is approved at submit by the system, in the submit transaction.
 * Decided by the role (no permission, no migration).
 */
export const AUTO_APPROVE_REASON = 'auto-approved, no manager';
export const isDirector = (p: Pick<Principal, 'roles'>) => p.roles.includes('director');

/** Approval subjects routed to the requester's manager: no manager is an error unless director. */
export const MANAGER_ROUTED = ['tour_plan', 'tour_plan_item', 'expense', 'leave'] as const;

/** System principal for decision hooks: same tenant and user, but decidedBy is written as null. */
export const systemPrincipal = (p: Principal): Principal => ({ ...p, system: true });
/** decidedBy / approvedBy for a decision made by `p` (null = the system). */
export const deciderId = (p: Pick<Principal, 'userId' | 'system'>) => (p.system ? null : p.userId);

/** after{} of every auto-approval audit record (approval.auto_approved, dcr.auto_approved). */
export const autoApproveAudit = (x: {
  subjectType: string;
  subjectId: string;
  requestId: string | null;
  requestedBy: string;
  at: Date;
}) => ({
  actor: 'system' as const,
  reason: AUTO_APPROVE_REASON,
  at: x.at.toISOString(),
  subjectType: x.subjectType,
  subjectId: x.subjectId,
  requestId: x.requestId,
  requestedBy: x.requestedBy,
  decision: 'approved' as const,
  decidedBy: null,
});

/** Request-time routing decision for a manager-routed subject. */
export function managerRoute(
  p: Pick<Principal, 'roles'>,
  entityType: string,
  managerId: string | null,
): { approverUserId: string | null; error: null | 'NO_MANAGER' } {
  if (managerId) return { approverUserId: managerId, error: null };
  if (isDirector(p)) return { approverUserId: null, error: null };
  return {
    approverUserId: null,
    error: (MANAGER_ROUTED as readonly string[]).includes(entityType) ? 'NO_MANAGER' : null,
  };
}
