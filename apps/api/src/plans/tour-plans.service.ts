import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  badDates,
  copyFromMonth,
  copyFromStandard,
  missingDates,
  prevMonth,
  type StandardTourPlan,
  type TourPlan,
} from '@ariforce/contracts';
import {
  chemists,
  doctors,
  planSessions,
  standardTourPlans,
  territories,
  tourPlans,
  tourPlanVisits,
  workTypes,
  type Tx,
} from '@ariforce/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { decodeCursor, encodeCursor } from '../masters/masters.service';
import { ApprovalsService } from './approvals.service';
import { approvedLeaveDays, assertNotOnLeave } from '../leave/leave.util';

const monthEnd = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

type Day = TourPlan['days'][number];
type Entry = Day['entries'][number];
type Row = typeof tourPlans.$inferSelect;
const EDITABLE = ['draft', 'rejected'];
const monthStart = (m: string) => `${m}-01`;

export function toPlan(r: Row): TourPlan {
  return {
    id: r.id,
    companyId: r.companyId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    version: r.version,
    userId: r.userId,
    month: r.month.slice(0, 7),
    kind: 'mtp',
    status: r.status,
    days: (r.days as Day[]) ?? [],
    submittedAt: r.submittedAt?.toISOString() ?? null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedBy: r.decidedBy,
    decisionComment: r.decisionComment,
  };
}

export interface TourPlanQuery {
  limit?: number;
  cursor?: string;
  sort?: string;
  includeTotal?: 'true' | 'false';
  from?: string;
  to?: string;
  userId?: string;
  month?: string;
  status?: TourPlan['status'];
}

@Injectable()
export class TourPlansService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  private team(p: Principal, userId?: string): string {
    const u = userId ?? p.userId;
    if (p.teamUserIds && !p.teamUserIds.includes(u))
      throw new ForbiddenException('User is outside your team');
    if (u !== p.userId && !p.permissions.includes('field:read'))
      throw new ForbiddenException('field:read required for team plans');
    return u;
  }

  private async find(tx: Tx, userId: string, month: string) {
    const [r] = await tx
      .select()
      .from(tourPlans)
      .where(
        and(
          eq(tourPlans.userId, userId),
          eq(tourPlans.month, monthStart(month)),
          isNull(tourPlans.deletedAt),
        ),
      );
    return r;
  }

  /** Work types, territories (in the caller's scope), doctors/chemists and joint-work users must exist. */
  private async validateEntries(tx: Tx, p: Principal, entries: Entry[]) {
    const uniq = <T>(a: T[]) => [...new Set(a)];
    const wt = uniq(entries.map((e) => e.workTypeId));
    const tt = uniq(entries.flatMap((e) => e.territoryIds));
    const dd = uniq(entries.flatMap((e) => e.plannedDoctorIds ?? []));
    const cc = uniq(entries.flatMap((e) => e.plannedChemistIds ?? []));
    const bad: Record<string, string[]> = {};
    const check = async (name: string, ids: string[], q: () => Promise<{ id: string }[]>) => {
      if (!ids.length) return;
      const found = new Set((await q()).map((r) => r.id));
      const miss = ids.filter((i) => !found.has(i));
      if (miss.length) bad[name] = miss;
    };
    const scope = this.tenant.scope(p, territories.path);
    await check('workTypeIds', wt, () =>
      tx
        .select({ id: workTypes.id })
        .from(workTypes)
        .where(and(inArray(workTypes.id, wt), isNull(workTypes.deletedAt))),
    );
    await check('territoryIds', tt, () =>
      tx
        .select({ id: territories.id })
        .from(territories)
        .where(and(inArray(territories.id, tt), scope)),
    );
    await check('plannedDoctorIds', dd, () =>
      tx
        .select({ id: doctors.id })
        .from(doctors)
        .innerJoin(territories, eq(territories.id, doctors.territoryId))
        .where(and(inArray(doctors.id, dd), isNull(doctors.deletedAt), scope)),
    );
    await check('plannedChemistIds', cc, () =>
      tx
        .select({ id: chemists.id })
        .from(chemists)
        .innerJoin(territories, eq(territories.id, chemists.territoryId))
        .where(and(inArray(chemists.id, cc), isNull(chemists.deletedAt), scope)),
    );
    if (Object.keys(bad).length)
      throw err(422, 'VALIDATION', 'Unknown or out-of-scope references', bad);
  }

  private async validateDays(tx: Tx, p: Principal, month: string, days: Day[]) {
    const bad = badDates(month, days);
    if (bad.length)
      throw err(422, 'VALIDATION', 'Dates outside the month or repeated', { dates: bad });
    for (const d of days) {
      const s = d.entries.map((e) => e.session);
      if (new Set(s).size !== s.length || (s.includes('full') && s.length > 1))
        throw err(422, 'VALIDATION', `Invalid sessions on ${d.date} (one full day, or am/pm)`);
    }
    await this.validateEntries(
      tx,
      p,
      days.flatMap((d) => d.entries),
    );
    // Approved leave (#51): only leave/holiday work types on leave days (same half for half days).
    const leave = await approvedLeaveDays(tx, [p.userId], `${month}-01`, monthEnd(month));
    if (leave.length) {
      const ids = [...new Set(days.flatMap((d) => d.entries.map((e) => e.workTypeId)))];
      const kinds = ids.length
        ? await tx
            .select({ id: workTypes.id, kind: workTypes.kind })
            .from(workTypes)
            .where(inArray(workTypes.id, ids))
        : [];
      assertNotOnLeave(
        leave,
        days.flatMap((d) =>
          d.entries.map((e) => ({
            date: d.date,
            session: e.session,
            kind: kinds.find((k) => k.id === e.workTypeId)?.kind ?? 'field',
          })),
        ),
      );
    }
  }

  /** Rebuild the derived rows (plan_sessions for attendance/DCR prefill; tour_plan_visits for adherence KPIs). */
  private async materialise(tx: Tx, p: Principal, plan: Row, days: Day[]) {
    const now = new Date();
    const month = plan.month.slice(0, 7);
    await tx
      .update(planSessions)
      .set({ deletedAt: now })
      .where(
        and(
          eq(planSessions.userId, plan.userId),
          gte(planSessions.date, `${month}-01`),
          lte(planSessions.date, `${month}-31`),
          isNull(planSessions.deletedAt),
        ),
      );
    await tx
      .update(tourPlanVisits)
      .set({ deletedAt: now })
      .where(and(eq(tourPlanVisits.tourPlanId, plan.id), isNull(tourPlanVisits.deletedAt)));
    const sessions = days.flatMap((d) =>
      d.entries.map((e, i) => ({
        id: uuidv7(),
        companyId: p.companyId,
        userId: plan.userId,
        date: d.date,
        sessionNo: i + 1,
        workTypeId: e.workTypeId,
        territoryId: e.territoryIds[0] ?? null,
        notes: e.notes ?? null,
      })),
    );
    if (sessions.length) await tx.insert(planSessions).values(sessions);
    const visits = days.flatMap((d) => {
      const docs = [...new Set(d.entries.flatMap((e) => e.plannedDoctorIds ?? []))];
      const chems = [...new Set(d.entries.flatMap((e) => e.plannedChemistIds ?? []))];
      return [
        ...docs.map((id) => ({ kind: 'doctor' as const, id })),
        ...chems.map((id) => ({ kind: 'chemist' as const, id })),
      ].map((o) => ({
        id: uuidv7(),
        companyId: p.companyId,
        tourPlanId: plan.id,
        date: d.date,
        outletKind: o.kind,
        outletId: o.id,
      }));
    });
    if (visits.length) await tx.insert(tourPlanVisits).values(visits);
  }

  private async save(tx: Tx, p: Principal, month: string, days: Day[], version?: number) {
    days = [...days].sort((a, b) => a.date.localeCompare(b.date));
    await this.validateDays(tx, p, month, days);
    const cur = await this.find(tx, p.userId, month);
    let row: Row;
    if (!cur) {
      [row] = (await tx
        .insert(tourPlans)
        .values({
          id: uuidv7(),
          companyId: p.companyId,
          userId: p.userId,
          month: monthStart(month),
          days,
        })
        .returning()) as [Row];
    } else {
      if (!EDITABLE.includes(cur.status))
        throw err(409, 'CONFLICT', `Plan is ${cur.status}; not editable`);
      if (version && version !== cur.version)
        throw err(409, 'VERSION_CONFLICT', 'Stale version', toPlan(cur));
      [row] = (await tx
        .update(tourPlans)
        .set({ days, status: 'draft', decidedAt: null, decidedBy: null })
        .where(eq(tourPlans.id, cur.id))
        .returning()) as [Row];
    }
    await this.materialise(tx, p, row, days);
    return row;
  }

  list(p: Principal, q: TourPlanQuery) {
    return this.tenant.run(p, async (tx) => {
      const u = q.userId ? this.team(p, q.userId) : undefined;
      if (!u && !p.permissions.includes('field:read') && p.teamUserIds === null)
        throw new ForbiddenException('field:read required');
      const where = [
        isNull(tourPlans.deletedAt),
        u
          ? eq(tourPlans.userId, u)
          : p.permissions.includes('field:read')
            ? p.teamUserIds
              ? inArray(tourPlans.userId, p.teamUserIds)
              : undefined
            : eq(tourPlans.userId, p.userId),
        q.month ? eq(tourPlans.month, monthStart(q.month)) : undefined,
        q.from ? gte(tourPlans.month, sql`date_trunc('month', ${q.from}::date)::date`) : undefined,
        q.to ? lte(tourPlans.month, q.to) : undefined,
        q.status ? eq(tourPlans.status, q.status as Row['status']) : undefined,
      ].filter(Boolean) as SQL[];
      const sort = q.sort ?? '-date';
      const field = sort.replace(/^-/, '');
      const col = {
        date: tourPlans.month,
        createdAt: tourPlans.createdAt,
        updatedAt: tourPlans.updatedAt,
      }[field];
      if (!col) throw err(422, 'VALIDATION', `Unknown sort field ${field}`);
      const dir = sort.startsWith('-') ? desc : asc;
      const limit = q.limit ?? 50;
      const offset = decodeCursor(q.cursor);
      const rows = await tx
        .select()
        .from(tourPlans)
        .where(and(...where))
        .orderBy(dir(col), dir(tourPlans.id))
        .limit(limit + 1)
        .offset(offset);
      const out: Record<string, unknown> = {
        items: rows.slice(0, limit).map(toPlan),
        nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
        serverTime: new Date().toISOString(),
      };
      if (q.includeTotal === 'true') {
        const [t] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(tourPlans)
          .where(and(...where));
        out.total = t!.n;
      }
      return out;
    });
  }

  get(p: Principal, month: string, userId?: string) {
    return this.tenant.run(p, async (tx) => {
      const r = await this.find(tx, this.team(p, userId), month);
      if (!r) throw new NotFoundException('No plan for this month');
      return toPlan(r);
    });
  }

  upsert(p: Principal, month: string, days: Day[], version?: number) {
    return this.tenant.run(p, async (tx) => {
      const r = await this.save(tx, p, month, days, version);
      await this.audit.record(tx, p, 'tour_plan.save', { entityType: 'tour_plan', entityId: r.id });
      return toPlan(r);
    });
  }

  copy(p: Principal, month: string, b: { fromMonth?: string; fromStp: boolean }) {
    return this.tenant.run(p, async (tx) => {
      let days: Day[];
      if (b.fromMonth || !b.fromStp) {
        const from = b.fromMonth ?? prevMonth(month);
        const src = await this.find(tx, p.userId, from);
        if (!src) throw new NotFoundException(`No plan for ${from}`);
        days = copyFromMonth(month, src.days as Day[]);
      } else {
        const [stp] = await tx
          .select()
          .from(standardTourPlans)
          .where(eq(standardTourPlans.userId, p.userId));
        if (!stp) throw new NotFoundException('No standard plan');
        days = copyFromStandard(month, stp.days as StandardTourPlan['days']);
      }
      const r = await this.save(tx, p, month, days);
      await this.audit.record(tx, p, 'tour_plan.copy', {
        entityType: 'tour_plan',
        entityId: r.id,
        after: { fromMonth: b.fromMonth ?? null, fromStp: b.fromStp },
      });
      return toPlan(r);
    });
  }

  submit(p: Principal, month: string) {
    return this.tenant.run(p, async (tx) => {
      const cur = await this.find(tx, p.userId, month);
      if (!cur) throw new NotFoundException('No plan for this month');
      if (cur.status !== 'draft') throw err(409, 'CONFLICT', 'Not in draft');
      // Dates fully on approved leave need no plan entry (#51).
      const off = new Set(
        (await approvedLeaveDays(tx, [p.userId], `${month}-01`, monthEnd(month)))
          .filter((l) => !l.half)
          .map((l) => l.date),
      );
      const missing = missingDates(month, cur.days as Day[]).filter((d) => !off.has(d));
      if (missing.length)
        throw err(422, 'VALIDATION', `${missing.length} date(s) have no plan entry`, {
          missingDates: missing,
        });
      const [row] = await tx
        .update(tourPlans)
        .set({ status: 'submitted', submittedAt: new Date() })
        .where(eq(tourPlans.id, cur.id))
        .returning();
      await this.approvals.request(tx, p, 'tour_plan', cur.id, null, { month });
      await this.audit.record(tx, p, 'tour_plan.submit', {
        entityType: 'tour_plan',
        entityId: cur.id,
      });
      return toPlan(row!);
    });
  }

  getStandard(p: Principal, userId?: string): Promise<StandardTourPlan> {
    return this.tenant.run(p, async (tx) => {
      const u = this.team(p, userId);
      const [r] = await tx.select().from(standardTourPlans).where(eq(standardTourPlans.userId, u));
      return r ? toStandard(r) : emptyStandard(p, u);
    });
  }

  putStandard(p: Principal, days: StandardTourPlan['days'], version?: number) {
    return this.tenant.run(p, async (tx) => {
      const keys = days.map((d) => `${d.week}|${d.weekday}`);
      if (new Set(keys).size !== keys.length)
        throw err(422, 'VALIDATION', 'Duplicate week/weekday');
      for (const d of days) {
        const s = d.entries.map((e) => e.session);
        if (new Set(s).size !== s.length || (s.includes('full') && s.length > 1))
          throw err(422, 'VALIDATION', `Invalid sessions on week ${d.week} day ${d.weekday}`);
      }
      await this.validateEntries(
        tx,
        p,
        days.flatMap((d) => d.entries),
      );
      days = [...days].sort((a, b) => a.week - b.week || a.weekday - b.weekday);
      const [cur] = await tx
        .select()
        .from(standardTourPlans)
        .where(eq(standardTourPlans.userId, p.userId));
      if (cur && version && cur.version !== version)
        throw err(409, 'VERSION_CONFLICT', 'Stale version', toStandard(cur));
      const [r] = cur
        ? await tx
            .update(standardTourPlans)
            .set({ days })
            .where(eq(standardTourPlans.id, cur.id))
            .returning()
        : await tx
            .insert(standardTourPlans)
            .values({ id: uuidv7(), companyId: p.companyId, userId: p.userId, days })
            .returning();
      await this.audit.record(tx, p, 'tour_plan.standard.save', {
        entityType: 'standard_tour_plan',
        entityId: r!.id,
      });
      return toStandard(r!);
    });
  }
}

function toStandard(r: typeof standardTourPlans.$inferSelect): StandardTourPlan {
  return {
    id: r.id,
    companyId: r.companyId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    version: r.version,
    userId: r.userId,
    days: r.days as StandardTourPlan['days'],
  };
}
function emptyStandard(p: Principal, userId: string): StandardTourPlan {
  const now = new Date().toISOString();
  return {
    id: uuidv7(),
    companyId: p.companyId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    userId,
    days: [],
  };
}
