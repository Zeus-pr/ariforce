import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  badDates,
  copyFromMonth,
  copyFromStandard,
  DEFAULT_WEEKLY_OFF_DAYS,
  istDate,
  requiredDates,
  prevMonth,
  type StandardTourPlan,
  type TourPlan,
  TourPlanDay,
} from '@ariforce/contracts';
import {
  chemists,
  leaveSettings,
  doctors,
  planSessions,
  standardTourPlans,
  territories,
  tourPlanSubmissions,
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
import { toPlan } from './tour-plan.dto';
import { dayStates, loadSubs, LOCKED, plansOut, storedDays, syncStatus } from './tp-submissions';
export { toPlan } from './tour-plan.dto';
import { approvedLeaveDays, assertNotOnLeave } from '../leave/leave.util';

const monthEnd = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

type Day = TourPlan['days'][number];
type Entry = Day['entries'][number];
type Row = typeof tourPlans.$inferSelect;
const monthStart = (m: string) => `${m}-01`;

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

  /**
   * Saves the month's days. Submitted/approved days are locked (#86): they must come back unchanged
   * (409 DAY_LOCKED otherwise). With `keepLocked` (copy) locked days are kept and the rest replaced.
   */
  private async save(
    tx: Tx,
    p: Principal,
    month: string,
    days: Day[],
    version?: number,
    keepLocked = false,
  ) {
    days = storedDays(days);
    const cur = await this.find(tx, p.userId, month);
    if (cur) {
      const st = dayStates(cur, await loadSubs(tx, [cur.id]));
      const old = new Map(((cur.days as Day[]) ?? []).map((d) => [d.date, d] as const));
      const locked = [...st].filter(([, v]) => LOCKED.includes(v.status)).map(([d]) => d);
      if (keepLocked)
        days = [
          ...days.filter((d) => !locked.includes(d.date)),
          ...locked.map((d) => old.get(d)!).filter(Boolean),
        ];
      const same = (a?: Day, b?: Day) =>
        JSON.stringify(a ? TourPlanDay.parse(storedDays([a])[0]).entries : null) ===
        JSON.stringify(b ? TourPlanDay.parse(storedDays([b])[0]).entries : null);
      const changed = locked.filter(
        (d) =>
          !same(
            old.get(d),
            days.find((x) => x.date === d),
          ),
      );
      if (changed.length)
        throw err(409, 'DAY_LOCKED', 'Submitted or approved days cannot be changed', {
          dates: changed,
        });
    }
    days = [...days].sort((a, b) => a.date.localeCompare(b.date));
    await this.validateDays(tx, p, month, days);
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
      if (version && version !== cur.version)
        throw err(409, 'VERSION_CONFLICT', 'Stale version', toPlan(cur));
      [row] = (await tx
        .update(tourPlans)
        // Rejected days keep their status (and reason) until resubmitted; status is re-derived below.
        .set({ days })
        .where(eq(tourPlans.id, cur.id))
        .returning()) as [Row];
    }
    await this.materialise(tx, p, row, days);
    await syncStatus(tx, row.id);
    [row] = (await tx.select().from(tourPlans).where(eq(tourPlans.id, row.id))) as [Row];
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
        items: await plansOut(tx, rows.slice(0, limit)),
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
      return (await plansOut(tx, [r]))[0]!;
    });
  }

  /**
   * GET /v1/tour-plans/{id}: the owner, the reporting line above them (with field:read, as for the
   * by-month read), or anyone assigned to approve it (current or past step). Otherwise 404.
   */
  getById(p: Principal, id: string) {
    return this.tenant.run(p, async (tx) => {
      const [r] = await tx
        .select()
        .from(tourPlans)
        .where(and(eq(tourPlans.id, id), isNull(tourPlans.deletedAt)));
      if (!r) throw new NotFoundException('Tour plan not found');
      const inLine =
        r.userId === p.userId ||
        (p.permissions.includes('field:read') &&
          (!p.teamUserIds || p.teamUserIds.includes(r.userId)));
      const subIds = (await loadSubs(tx, [id])).map((x) => x.id);
      let assigned = false;
      for (const e of [id, ...subIds])
        if (!assigned) assigned = await this.approvals.isAssigned(tx, p, 'tour_plan', e);
      if (!inLine && !assigned) throw new NotFoundException('Tour plan not found');
      return (await plansOut(tx, [r]))[0]!;
    });
  }

  upsert(p: Principal, month: string, days: Day[], version?: number) {
    return this.tenant.run(p, async (tx) => {
      const r = await this.save(tx, p, month, days, version);
      await this.audit.record(tx, p, 'tour_plan.save', { entityType: 'tour_plan', entityId: r.id });
      return (await plansOut(tx, [r]))[0]!;
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
      const r = await this.save(tx, p, month, days, undefined, true);
      await this.audit.record(tx, p, 'tour_plan.copy', {
        entityType: 'tour_plan',
        entityId: r.id,
        after: { fromMonth: b.fromMonth ?? null, fromStp: b.fromStp },
      });
      return (await plansOut(tx, [r]))[0]!;
    });
  }

  /** Company weekly off from leave_settings (same source as leave counting); default Sunday. */
  private async weeklyOff(tx: Tx): Promise<number[]> {
    const [s] = await tx
      .select({ w: leaveSettings.weeklyOffDays })
      .from(leaveSettings)
      .where(isNull(leaveSettings.deletedAt));
    return s?.w ?? DEFAULT_WEEKLY_OFF_DAYS;
  }

  calendar(p: Principal, month: string, now = new Date()) {
    return this.tenant.run(p, async (tx) => {
      const weeklyOffDays = await this.weeklyOff(tx);
      const todayIST = istDate(now);
      const cur = await this.find(tx, p.userId, month);
      const st = cur ? dayStates(cur, await loadSubs(tx, [cur.id])) : new Map();
      return {
        month,
        todayIST,
        weeklyOffDays,
        days: [...st]
          .map(([date, v]) => ({ date, status: v.status, submissionId: v.submissionId }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        requiredDates: requiredDates(month, todayIST, weeklyOffDays),
      };
    });
  }

  /**
   * Submits a set of days as one submission with its own approval request (#86). Default set: every
   * planned day that is draft or rejected. Locked days -> 409 DAY_LOCKED; nothing planned -> 422.
   */
  submit(p: Principal, month: string, submitterNote?: string | null, dates?: string[]) {
    return this.tenant.run(p, async (tx) => {
      const cur = await this.find(tx, p.userId, month);
      if (!cur) throw new NotFoundException('No plan for this month');
      const st = dayStates(cur, await loadSubs(tx, [cur.id]));
      const days = (cur.days as Day[]) ?? [];
      if (dates) {
        const out = dates.filter((d) => d.slice(0, 7) !== month);
        if (out.length) throw err(422, 'VALIDATION', 'Dates outside the month', { dates: out });
        const locked = dates.filter((d) => LOCKED.includes(st.get(d)?.status ?? 'draft'));
        if (locked.length)
          throw err(409, 'DAY_LOCKED', 'Already submitted or approved', { dates: locked });
      }
      const pick = [
        ...new Set(
          (dates ?? days.map((d) => d.date)).filter((d) => {
            const day = days.find((x) => x.date === d);
            return !!day?.entries.length && !LOCKED.includes(st.get(d)?.status ?? 'draft');
          }),
        ),
      ].sort();
      // Any day may be left empty (past days, weekly offs, leave, unplanned days); a submission
      // only needs one planned day (user decision superseding #19).
      if (!pick.length)
        throw err(422, 'EMPTY_PLAN', 'Add at least one day to the plan before submitting');
      const note = submitterNote?.trim() || null;
      const subId = uuidv7();
      await tx.insert(tourPlanSubmissions).values({
        id: subId,
        companyId: p.companyId,
        tourPlanId: cur.id,
        userId: p.userId,
        dates: pick,
        submitterNote: note,
      });
      await tx
        .update(tourPlans)
        .set({ submittedAt: new Date(), submitterNote: note })
        .where(eq(tourPlans.id, cur.id));
      await syncStatus(tx, cur.id);
      const reqId = await this.approvals.request(tx, p, 'tour_plan', subId, note, {
        month,
        planId: cur.id,
        submissionId: subId,
        dates: pick,
      });
      await this.audit.record(tx, p, 'tour_plan.submit', {
        entityType: 'tour_plan',
        entityId: cur.id,
        after: { submissionId: subId, dates: pick },
      });
      // Director: approved now by the system (no manager).
      await this.approvals.autoApprove(tx, p, reqId);
      const [row] = await tx.select().from(tourPlans).where(eq(tourPlans.id, cur.id));
      return (await plansOut(tx, [row!]))[0]!;
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
