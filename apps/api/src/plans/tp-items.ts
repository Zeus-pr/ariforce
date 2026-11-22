import {
  TourPlanItemPlan,
  tpItemCard,
  tpItemFiledDates,
  type TourPlanItem,
} from '@ariforce/contracts';
import { dcrs, sfcRoutes, tourPlanItems, users, type Tx } from '@ariforce/db';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { dayTaDa } from '../allowances/section-ta-da';

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
  const groups = rows.map((r) => routeGroups(r.plan));
  const routeIds = [...new Set(groups.flat(2))];
  const fares = routeIds.length
    ? await tx
        .select({
          id: sfcRoutes.id,
          hqTerritoryId: sfcRoutes.hqTerritoryId,
          fromPlace: sfcRoutes.fromPlace,
          toPlace: sfcRoutes.toPlace,
          oneWayKm: sfcRoutes.oneWayKm,
          bothWayKm: sfcRoutes.bothWayKm,
          oneWayAmount: sfcRoutes.oneWayAmount,
          bothWayAmount: sfcRoutes.bothWayAmount,
          actualFare: sfcRoutes.actualFare,
          travelMode: sfcRoutes.travelMode,
          category: sfcRoutes.category,
          da: sfcRoutes.da,
        })
        .from(sfcRoutes)
        .where(inArray(sfcRoutes.id, routeIds))
    : [];
  const num = (v: string | number | null) => (v == null ? null : Number(v));
  const fareOf = new Map(
    fares.map((f) => [
      f.id,
      {
        id: f.id,
        bothWayAmount: num(f.bothWayAmount),
        da: num(f.da),
      },
    ]),
  );
  const factOf = new Map(
    fares.map((f) => [
      f.id,
      {
        id: f.id,
        hqTerritoryId: f.hqTerritoryId,
        fromPlace: f.fromPlace,
        toPlace: f.toPlace,
        oneWayKm: Number(f.oneWayKm),
        bothWayKm: Number(f.bothWayKm),
        oneWayAmount: num(f.oneWayAmount),
        bothWayAmount: num(f.bothWayAmount),
        actualFare: f.actualFare,
        travelMode: f.travelMode,
        category: f.category,
        da: num(f.da),
      },
    ]),
  );
  return rows.map((r, i) => {
    const money = dayTaDa(
      groups[i]!.map((ids) =>
        ids.map((id) => fareOf.get(id) ?? { id, bothWayAmount: null, da: null }),
      ),
    );
    return {
      id: r.id,
      companyId: r.companyId,
      userId: r.userId,
      userName: names.find((n) => n.id === r.userId)?.name ?? '',
      from: r.fromDate,
      to: r.toDate,
      status: apiStatus(r.status),
      rejectionReason: r.status === 'rejected' ? r.decisionComment : null,
      plan: TourPlanItemPlan.parse(r.plan),
      routeFacts: [...new Set(groups[i]!.flat())].flatMap((id) => {
        const fact = factOf.get(id);
        return fact ? [fact] : [];
      }),
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
      ta: money.ta,
      da: money.da,
    };
  });
}

function routeGroups(plan: unknown): string[][] {
  const ids = (rows?: { sfcRouteId?: string }[]) =>
    (rows ?? []).map((r) => r.sfcRouteId).filter((id): id is string => !!id);
  const walk = (node?: {
    sfcRoutes?: { sfcRouteId?: string }[];
    sections?: { sfcRoutes?: { sfcRouteId?: string }[] }[];
    days?: {
      sfcRoutes?: { sfcRouteId?: string }[];
      sections?: { sfcRoutes?: { sfcRouteId?: string }[] }[];
    }[];
  }): string[][] => {
    if (!node) return [];
    return [
      ids(node.sfcRoutes),
      ...(node.sections ?? []).map((section) => ids(section.sfcRoutes)),
      ...(node.days ?? []).flatMap((day) => [
        ids(day.sfcRoutes),
        ...(day.sections ?? []).map((section) => ids(section.sfcRoutes)),
      ]),
    ];
  };
  return walk(plan as Parameters<typeof walk>[0]);
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
