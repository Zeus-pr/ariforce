import {
  TourPlanItemPlan,
  tpItemCard,
  tpItemFiledDates,
  type TourPlanItem,
} from '@ariforce/contracts';
import { dcrs, tourPlanItems, users, type Tx } from '@ariforce/db';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

export type ItemRow = typeof tourPlanItems.$inferSelect;
type Report = { userId: string; date: string; status: string };

/** DB 'submitted' is the API's 'pending'. */
export const apiStatus = (s: ItemRow['status']): TourPlanItem['status'] =>
  s === 'submitted' ? 'pending' : s;
export const dbStatus = (s: TourPlanItem['status']): ItemRow['status'] =>
  s === 'pending' ? 'submitted' : s;

/** Live reports (any status) of these users in [from, to]. */
async function reportsOf(tx: Tx, userIds: string[], from: string, to: string): Promise<Report[]> {
  if (!userIds.length) return [];
  return tx
    .select({ userId: dcrs.userId, date: dcrs.date, status: dcrs.status })
    .from(dcrs)
    .where(
      and(
        inArray(dcrs.userId, userIds),
        gte(dcrs.date, from),
        lte(dcrs.date, to),
        isNull(dcrs.deletedAt),
      ),
    );
}

export async function itemsOut(tx: Tx, rows: ItemRow[]): Promise<TourPlanItem[]> {
  if (!rows.length) return [];
  const uids = [...new Set(rows.map((r) => r.userId))];
  const names = await tx
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, uids));
  const from = rows.reduce((m, r) => (r.fromDate < m ? r.fromDate : m), rows[0]!.fromDate);
  const to = rows.reduce((m, r) => (r.toDate > m ? r.toDate : m), rows[0]!.toDate);
  const reps = await reportsOf(tx, uids, from, to);
  return rows.map((r) => ({
    id: r.id,
    companyId: r.companyId,
    userId: r.userId,
    userName: names.find((n) => n.id === r.userId)?.name ?? '',
    from: r.fromDate,
    to: r.toDate,
    status: apiStatus(r.status),
    rejectionReason: r.status === 'rejected' ? r.decisionComment : null,
    plan: TourPlanItemPlan.parse(r.plan),
    filedDates: tpItemFiledDates(
      r.fromDate,
      r.toDate,
      reps.filter((x) => x.userId === r.userId),
    ),
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedBy: r.decidedBy,
  }));
}

/** The user's approved item covering `date` (the most recently approved if several), or null. */
export async function approvedItemOn(tx: Tx, userId: string, date: string) {
  const rows = await tx
    .select()
    .from(tourPlanItems)
    .where(
      and(
        eq(tourPlanItems.userId, userId),
        eq(tourPlanItems.status, 'approved'),
        lte(tourPlanItems.fromDate, date),
        gte(tourPlanItems.toDate, date),
        isNull(tourPlanItems.deletedAt),
      ),
    );
  return (
    rows.sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))[0] ?? null
  );
}

/** The user's approved items as DCR draft cards (options.tourPlanDrafts), by from. */
export async function itemCards(tx: Tx, userId: string, today: string) {
  const rows = await tx
    .select()
    .from(tourPlanItems)
    .where(
      and(
        eq(tourPlanItems.userId, userId),
        eq(tourPlanItems.status, 'approved'),
        gte(tourPlanItems.toDate, today),
        isNull(tourPlanItems.deletedAt),
      ),
    )
    .orderBy(asc(tourPlanItems.fromDate), asc(tourPlanItems.id));
  if (!rows.length) return [];
  const items = await itemsOut(tx, rows);
  const from = rows[0]!.fromDate;
  const to = rows.reduce((m, r) => (r.toDate > m ? r.toDate : m), today);
  const reps = await reportsOf(tx, [userId], from, to);
  return items.flatMap((it) => {
    const c = tpItemCard(it, reps, today);
    return c ? [{ ...it, ...c }] : [];
  });
}
