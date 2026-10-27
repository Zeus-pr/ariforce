import type { TourPlan, TourPlanSubmission } from '@ariforce/contracts';
import { approvalRequests, tourPlanSubmissions, tourPlans, users, type Tx } from '@ariforce/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { nameRejecters, rejectionFields } from '../common/rejection';
import { toPlan } from './tour-plan.dto';

/**
 * Tour plan submissions (#86, docs/TOUR-PLANS.md). A day's status is the status of the latest
 * submission that holds it (draft when none). Submitted/approved days are locked.
 */
type SubRow = typeof tourPlanSubmissions.$inferSelect;
type PlanRow = typeof tourPlans.$inferSelect;
type Day = TourPlan['days'][number];
export type DayStatus = NonNullable<Day['status']>;
export interface DayState {
  status: DayStatus;
  submissionId: string | null;
}

export const LOCKED: DayStatus[] = ['submitted', 'approved'];

export async function loadSubs(tx: Tx, planIds: string[]): Promise<SubRow[]> {
  if (!planIds.length) return [];
  return tx
    .select()
    .from(tourPlanSubmissions)
    .where(
      and(inArray(tourPlanSubmissions.tourPlanId, planIds), isNull(tourPlanSubmissions.deletedAt)),
    )
    .orderBy(asc(tourPlanSubmissions.submittedAt), asc(tourPlanSubmissions.id));
}

const planned = (d: Day | undefined) => !!d && d.entries.length > 0;

/** date -> status. Plans from before #86 with no submission: every planned day takes the plan status. */
export function dayStates(plan: PlanRow, subs: SubRow[]): Map<string, DayState> {
  const days = (plan.days as Day[]) ?? [];
  const out = new Map<string, DayState>();
  const mine = subs.filter((s) => s.tourPlanId === plan.id);
  if (!mine.length && ['submitted', 'approved', 'rejected'].includes(plan.status)) {
    for (const d of days)
      if (planned(d)) out.set(d.date, { status: plan.status as DayStatus, submissionId: null });
  } else
    for (const s of mine)
      for (const dt of s.dates) out.set(dt, { status: s.status as DayStatus, submissionId: s.id });
  for (const d of days) {
    const st = out.get(d.date);
    // A rejected day whose entries were all removed is just an empty draft day again.
    if (!st || (st.status === 'rejected' && !planned(d)))
      out.set(d.date, { status: 'draft', submissionId: null });
  }
  return out;
}

/** Month-level status kept for older clients and reports (see TourPlan.status). */
export function aggregate(plan: PlanRow, subs: SubRow[]): PlanRow['status'] {
  const st = dayStates(plan, subs);
  const days = (plan.days as Day[]) ?? [];
  const has = (s: DayStatus) => [...st.values()].some((v) => v.status === s);
  if (has('submitted')) return 'submitted';
  if (has('rejected')) return 'rejected';
  if (days.some((d) => planned(d) && st.get(d.date)?.status === 'draft') && has('approved'))
    return 'draft';
  if (has('approved')) return 'approved';
  return 'draft';
}

/** Recompute and store tour_plans.status. */
export async function syncStatus(tx: Tx, planId: string) {
  const [plan] = await tx.select().from(tourPlans).where(eq(tourPlans.id, planId));
  if (!plan) return;
  const status = aggregate(plan, await loadSubs(tx, [planId]));
  if (status !== plan.status)
    await tx.update(tourPlans).set({ status }).where(eq(tourPlans.id, planId));
}

/** Approval request ids per submission (entity_id = submission id). */
async function approvalIds(tx: Tx, subIds: string[]) {
  if (!subIds.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: approvalRequests.id, e: approvalRequests.entityId })
    .from(approvalRequests)
    .where(
      and(eq(approvalRequests.entityType, 'tour_plan'), inArray(approvalRequests.entityId, subIds)),
    )
    .orderBy(asc(approvalRequests.createdAt));
  return new Map(rows.map((r) => [r.e, r.id] as const));
}

/** Plan rows -> TourPlan DTOs with day statuses, submissions and names resolved. */
export async function plansOut(tx: Tx, rows: PlanRow[]): Promise<TourPlan[]> {
  const subs = await loadSubs(
    tx,
    rows.map((r) => r.id),
  );
  const appr = await approvalIds(
    tx,
    subs.map((s) => s.id),
  );
  const uid = [...new Set(subs.flatMap((s) => (s.decidedBy ? [s.decidedBy] : [])))];
  const names = new Map(
    (uid.length
      ? await tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, uid))
      : []
    ).map((u) => [u.id, u.name] as const),
  );
  const ref = (id: string | null) => (id ? { id, name: names.get(id) ?? '' } : null);
  const out = rows.map((r) => {
    const mine = subs.filter((s) => s.tourPlanId === r.id);
    const st = dayStates(r, mine);
    const status = aggregate(r, mine);
    const submissions: TourPlanSubmission[] = mine.map((s) => {
      const rej = rejectionFields(s.status, s.decisionComment, s.decidedBy, iso(s.decidedAt));
      return {
        id: s.id,
        tourPlanId: s.tourPlanId,
        dates: s.dates,
        status: s.status as TourPlanSubmission['status'],
        approvalId: appr.get(s.id) ?? null,
        submitterNote: s.submitterNote,
        submittedAt: s.submittedAt.toISOString(),
        decidedAt: iso(s.decidedAt),
        decidedBy: ref(s.decidedBy),
        decisionComment: s.decisionComment,
        rejectionReason: rej.rejectionReason,
        rejectedBy: rej.rejectedBy ? ref(rej.rejectedBy.id) : null,
        rejectedAt: rej.rejectedAt,
      };
    });
    const base = toPlan({ ...r, status });
    const lastRej = [...submissions].reverse().find((s) => s.status === 'rejected');
    return {
      ...base,
      days: base.days.map((d) => ({ ...d, ...st.get(d.date)! })),
      submissions,
      // Plan-level rejection info: the latest rejected submission while the plan reads rejected
      // (pre-#86 plans without submissions keep their own decision columns).
      ...(mine.length
        ? {
            rejectionReason: status === 'rejected' ? (lastRej?.rejectionReason ?? null) : null,
            rejectedBy: status === 'rejected' ? (lastRej?.rejectedBy ?? null) : null,
            rejectedAt: status === 'rejected' ? (lastRej?.rejectedAt ?? null) : null,
          }
        : {}),
    };
  });
  return nameRejecters(tx, out);
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Strip response-only day fields before storing. */
export const storedDays = (days: Day[]): Day[] =>
  days.map(({ date, entries }) => ({ date, entries }));
