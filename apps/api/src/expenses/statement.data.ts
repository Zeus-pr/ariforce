import {
  companies,
  dcrCalls,
  dcrs,
  dcrSfcRoutes,
  divisions,
  leavePolicies,
  leaveRequests,
  leaveSettings,
  productHqMappings,
  territories,
  userTerritories,
  users,
  workTypes,
  type Tx,
} from '@ariforce/db';
import { and, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { isDayReport } from '../dcr/day-report';
import type { ExpensesService } from './expenses.service';
import {
  claimStatusLabel,
  type StatementDcr,
  type StatementHeader,
  type StatementInput,
} from './statement';

type Data = Awaited<ReturnType<ExpensesService['reportData']>>;

const nextMonthStart = (m: string) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
};

/** Everything the per-employee monthly statement needs, in a fixed number of queries. */
export async function loadStatements(
  tx: Tx,
  companyId: string,
  month: string,
  data: Data,
): Promise<StatementInput[]> {
  if (!data.length) return [];
  const userIds = [...new Set(data.map((d) => d.rec.userId))];
  const from = `${month}-01`;
  const to = nextMonthStart(month);

  const people = await tx
    .select({
      id: users.id,
      employeeCode: users.employeeCode,
      designation: users.designation,
      joinedOn: users.joinedOn,
      phone: users.phone,
      email: users.email,
      managerId: users.managerId,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  const managerIds = [...new Set(people.flatMap((u) => (u.managerId ? [u.managerId] : [])))];
  const managers = managerIds.length
    ? await tx
        .select({ id: users.id, name: users.name, code: users.employeeCode })
        .from(users)
        .where(inArray(users.id, managerIds))
    : [];
  const [company] = await tx
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId));

  const primary = await tx
    .select({ userId: userTerritories.userId, territoryId: userTerritories.territoryId })
    .from(userTerritories)
    .where(and(inArray(userTerritories.userId, userIds), eq(userTerritories.isPrimary, true)));
  const hqIds = [...new Set(primary.map((x) => x.territoryId))];

  // Ancestors of every HQ, so the region name can be found without loading all territories.
  const ancestors = hqIds.length
    ? (
        await tx.execute<{ origin: string; level: string; name: string }>(sql`
          with recursive a as (
            select id, parent_id, level, name, id as origin from territories
              where id in (${sql.join(
                hqIds.map((i) => sql`${i}`),
                sql`, `,
              )})
            union all
            select t.id, t.parent_id, t.level, t.name, a.origin
              from territories t join a on t.id = a.parent_id)
          select origin, level, name from a`)
      ).rows
    : [];
  const mapped = hqIds.length
    ? await tx
        .select({ territoryId: productHqMappings.territoryId, name: divisions.name })
        .from(productHqMappings)
        .innerJoin(divisions, eq(divisions.id, productHqMappings.divisionId))
        .where(
          and(inArray(productHqMappings.territoryId, hqIds), isNull(productHqMappings.deletedAt)),
        )
    : [];
  const hqNames = hqIds.length
    ? await tx
        .select({ id: territories.id, name: territories.name })
        .from(territories)
        .where(inArray(territories.id, hqIds))
    : [];

  const reports = await tx
    .select({
      id: dcrs.id,
      userId: dcrs.userId,
      date: dcrs.date,
      status: dcrs.status,
      band: dcrs.band,
      territoryIds: dcrs.territoryIds,
      workWith: dcrs.workWithUserIds,
      wtName: workTypes.name,
      wtKind: workTypes.kind,
    })
    .from(dcrs)
    .innerJoin(workTypes, eq(workTypes.id, dcrs.workTypeId))
    .where(
      and(
        inArray(dcrs.userId, userIds),
        isNull(dcrs.deletedAt),
        isDayReport(dcrs),
        ne(dcrs.status, 'rejected'),
        gte(dcrs.date, from),
        lt(dcrs.date, to),
      ),
    );
  const dcrIds = reports.map((r) => r.id);
  const calls = dcrIds.length
    ? await tx
        .select({ dcrId: dcrCalls.dcrId, n: sql<number>`count(*)::int` })
        .from(dcrCalls)
        .where(
          and(
            inArray(dcrCalls.dcrId, dcrIds),
            eq(dcrCalls.outletKind, 'doctor'),
            isNull(dcrCalls.deletedAt),
          ),
        )
        .groupBy(dcrCalls.dcrId)
    : [];
  const routes = dcrIds.length
    ? await tx
        .select({ dcrId: dcrSfcRoutes.dcrId, snapshot: dcrSfcRoutes.snapshot })
        .from(dcrSfcRoutes)
        .where(and(inArray(dcrSfcRoutes.dcrId, dcrIds), isNull(dcrSfcRoutes.deletedAt)))
    : [];
  const placeIds = [...new Set(reports.flatMap((r) => r.territoryIds ?? []))];
  const places = placeIds.length
    ? await tx
        .select({ id: territories.id, name: territories.name })
        .from(territories)
        .where(inArray(territories.id, placeIds))
    : [];

  const leaves = await tx
    .select({
      userId: leaveRequests.userId,
      from: leaveRequests.fromDate,
      to: leaveRequests.toDate,
      policy: leavePolicies.name,
    })
    .from(leaveRequests)
    .innerJoin(leavePolicies, eq(leavePolicies.id, leaveRequests.policyId))
    .where(
      and(
        inArray(leaveRequests.userId, userIds),
        eq(leaveRequests.status, 'approved'),
        lt(leaveRequests.fromDate, to),
        gte(leaveRequests.toDate, from),
      ),
    );
  const [settings] = await tx
    .select({ off: leaveSettings.weeklyOffDays })
    .from(leaveSettings)
    .where(eq(leaveSettings.companyId, companyId));

  const placeName = new Map(places.map((p) => [p.id, p.name]));
  const callCount = new Map(calls.map((c) => [c.dcrId, c.n]));

  return data.map((d): StatementInput => {
    const u = people.find((x) => x.id === d.rec.userId);
    const mgr = managers.find((x) => x.id === u?.managerId);
    const hqId = primary.find((x) => x.userId === d.rec.userId)?.territoryId;
    const region = ancestors.find((a) => a.origin === hqId && a.level === 'region')?.name ?? null;
    const header: StatementHeader = {
      userName: d.userName,
      employeeCode: u?.employeeCode ?? null,
      designation: u?.designation ?? null,
      region,
      hq: hqNames.find((h) => h.id === hqId)?.name ?? null,
      division:
        [...new Set(mapped.filter((m) => m.territoryId === hqId).map((m) => m.name))].join(', ') ||
        null,
      joinedOn: u?.joinedOn ?? null,
      managerName: mgr?.name ?? null,
      managerCode: mgr?.code ?? null,
      phone: u?.phone ?? null,
      email: u?.email ?? null,
      company: company?.name ?? '',
      status: claimStatusLabel(d.status),
    };
    const dcrRows: StatementDcr[] = reports
      .filter((r) => r.userId === d.rec.userId)
      .map((r) => {
        const mine = routes.filter((x) => x.dcrId === r.id);
        const snaps = mine.flatMap((x) => {
          const s = x.snapshot as {
            fromPlace?: string;
            toPlace?: string;
            travelMode?: string | null;
            bothWayKm?: number;
          } | null;
          return s ? [s] : [];
        });
        return {
          date: r.date,
          workTypeName: r.wtName,
          workTypeKind: r.wtKind,
          status: r.status,
          band: r.band,
          places: (r.territoryIds ?? []).flatMap((id) => placeName.get(id) ?? []),
          routes: snaps.map(
            (s) =>
              `${s.fromPlace ?? ''} TO ${s.toPlace ?? ''}${s.travelMode ? ` (${s.travelMode.toUpperCase()})` : ''}`,
          ),
          distanceKm: snaps.reduce((a, s) => a + (s.bothWayKm ?? 0), 0),
          doctorsMet: callCount.get(r.id) ?? 0,
          accompanists: (r.workWith ?? []).length,
        };
      });
    return {
      month,
      header,
      dcrs: dcrRows,
      lines: d.lines
        .filter((l) => !l.dcrRejectedAt)
        .map((l) => ({
          date: l.date,
          category: l.category,
          amount: Number(l.amount),
          notes: l.notes,
          mileageKm: l.mileageKm === null ? null : Number(l.mileageKm),
        })),
      leaves: leaves.filter((l) => l.userId === d.rec.userId),
      weeklyOffDays: settings?.off ?? [0],
    };
  });
}
