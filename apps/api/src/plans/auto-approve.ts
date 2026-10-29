import type { Principal } from '../auth/principal';

/**
 * Directors have no manager (Sharanya 2026-10-29): what a director submits (DCR, tour plan, tour
 * plan item, expense claim, leave) is approved at submit by the system, in the submit transaction.
 * Decided by the role (no permission, no migration).
 */
export const AUTO_APPROVE_REASON = 'auto-approved, no manager';
export const isDirector = (p: Pick<Principal, 'roles'>) => p.roles.includes('director');

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
