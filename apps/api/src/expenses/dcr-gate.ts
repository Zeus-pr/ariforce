/**
 * Expense approval gate (rule from Sharanya, 2026-10-29): a claim can be approved (any step, any
 * route) only when every expense date has an APPROVED DCR of the claim owner. Submitted, draft and
 * rejected reports do not count; a missing report is 'missing'.
 */
export type GateDcr = { id: string; date: string; status: string; updatedAt: Date };
export type DcrGap = {
  dates: string[];
  dcrIds: string[];
  dcrStatus: Record<string, 'draft' | 'submitted' | 'rejected' | 'missing'>;
};

const RANK: Record<string, number> = { submitted: 0, draft: 1, rejected: 2 };

/** Dates without an approved DCR, the best non-approved report of each (submitted > draft > rejected). */
export function dcrApprovalGap(dates: string[], rows: GateDcr[]): DcrGap | null {
  const uniq = [...new Set(dates)].sort();
  const gap = uniq.filter((d) => !rows.some((r) => r.date === d && r.status === 'approved'));
  if (!gap.length) return null;
  const dcrIds: string[] = [];
  const dcrStatus: DcrGap['dcrStatus'] = {};
  for (const d of gap) {
    const best = rows
      .filter((r) => r.date === d && r.status in RANK)
      .sort(
        (a, b) =>
          RANK[a.status]! - RANK[b.status]! ||
          b.updatedAt.getTime() - a.updatedAt.getTime() ||
          b.id.localeCompare(a.id),
      )[0];
    if (best) dcrIds.push(best.id);
    dcrStatus[d] = best ? (best.status as 'draft' | 'submitted' | 'rejected') : 'missing';
  }
  return { dates: gap, dcrIds, dcrStatus };
}
