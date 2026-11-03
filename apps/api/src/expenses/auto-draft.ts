import type { AllowanceDay, ExpenseAutoDraft } from '@ariforce/contracts';

/** Claim statuses the auto-draft (and the rejection cleanup) may change; the rest are locked. */
export const EDITABLE_CLAIM_STATUSES = ['draft', 'rejected'] as const;
export const claimEditable = (status: string) =>
  (EDITABLE_CLAIM_STATUSES as readonly string[]).includes(status);

/** First day of the DCR date's month (expense_claims.month). */
export const claimMonth = (date: string) => `${date.slice(0, 7)}-01`;

type Base = Pick<ExpenseAutoDraft, 'date' | 'dcrId' | 'claimId' | 'claimStatus' | 'claimCreated'>;
const zero = { lines: 0, da: 0, ta: 0, km: 0 };

/**
 * Decides what the DCR-submit auto-draft writes for one day, before anything is written:
 * a locked claim is never touched, a manual allowance/mileage line on the day wins (nothing is
 * drafted), no computed line means nothing to draft; otherwise the day's auto lines are replaced.
 * Engine problems (no_rate, place_required) ride along in issues.
 */
export function autoDraftPlan(
  base: Base,
  claimStatus: string,
  day: AllowanceDay | undefined,
  lines: { amount: number; category: string; mileageKm: number | null }[],
): { write: boolean; result: ExpenseAutoDraft } {
  const issues = day?.issues ?? [];
  const skip = (reason: NonNullable<ExpenseAutoDraft['reason']>) => ({
    write: false,
    result: { ...base, ...zero, status: 'skipped' as const, reason, issues, error: null },
  });
  if (!claimEditable(claimStatus)) return skip('claim_locked');
  if (issues.includes('manual_line_exists')) return skip('manual_line_exists');
  if (!lines.length) return skip('no_allowance');
  const sum = (f: (l: (typeof lines)[number]) => number) =>
    Math.round(lines.reduce((s, l) => s + f(l), 0) * 100) / 100;
  return {
    write: true,
    result: {
      ...base,
      status: 'drafted',
      reason: null,
      lines: lines.length,
      da: sum((l) => (l.category === 'allowance' ? l.amount : 0)),
      ta: sum((l) => (l.category === 'allowance' ? 0 : l.amount)),
      km: sum((l) => l.mileageKm ?? 0),
      issues,
      error: null,
    },
  };
}

/** Engine failure: nothing written (savepoint rolled back); the DCR submit still succeeds. */
export function autoDraftError(base: Base, e: unknown): ExpenseAutoDraft {
  const o = (e ?? {}) as { response?: { code?: unknown }; code?: unknown; message?: unknown };
  const code =
    typeof o.response?.code === 'string'
      ? o.response.code
      : typeof o.code === 'string' && /^[A-Z_]+$/.test(o.code)
        ? o.code
        : 'AUTO_DRAFT_FAILED';
  const message = (typeof o.message === 'string' ? o.message : String(e)).slice(0, 200);
  return { ...base, ...zero, status: 'error', reason: null, issues: [], error: { code, message } };
}

/**
 * DCR rejected: what happens to the day's lines in the rep's month claim. Editable claim: auto
 * lines are removed, manual lines flagged. Locked claim (submitted/approved/paid): nothing is
 * removed, every live line of the day is flagged (dcr_rejected_at) for the approver / finance.
 */
export function rejectionPlan(
  claimStatus: string,
  lines: { id: string; source: string; flagged: boolean }[],
) {
  const editable = claimEditable(claimStatus);
  const remove = editable ? lines.filter((l) => l.source === 'auto').map((l) => l.id) : [];
  const flag = lines.filter((l) => !l.flagged && !remove.includes(l.id)).map((l) => l.id);
  return { editable, remove, flag };
}
