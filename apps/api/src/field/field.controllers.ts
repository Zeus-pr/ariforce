import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import {
  CheckInCreate,
  CheckInListQuery,
  FieldListQuery,
  UserListQuery,
  type AttendanceDay,
  type UserSummary,
} from '@ariforce/contracts';
import {
  dcrs,
  geoCaptures,
  roles,
  territories,
  userRoles,
  userTerritories,
  users,
  workTypes,
} from '@ariforce/db';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { ZodPipe } from '../common/zod.pipe';
import { decodeCursor, encodeCursor } from '../masters/masters.service';
import { CheckInsService, capDate, err, toCheckIn, type CheckInQuery } from './checkins.service';
import { MAX_RANGE_DAYS, companySettings, dateRange, localDate } from './field.util';

@Controller({ path: 'check-ins', version: '1' })
export class CheckInsController {
  constructor(private readonly svc: CheckInsService) {}

  @Get()
  @RequirePermissions('field:read')
  list(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(CheckInListQuery)) q: CheckInQuery) {
    return this.svc.list(p, q);
  }

  /** 201 created, 200 on an idempotent replay of the same clientId. */
  @Post()
  @RequirePermissions('field:write')
  async create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(CheckInCreate)) b: CheckInCreate,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.svc.create(p, b);
    res.status(r.replay ? 200 : 201);
    return r.body;
  }
}

/** Per user per day: present / incomplete / absent / leave / holiday (team rows, gap #3). */
@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  constructor(
    private readonly tenant: TenantService,
    private readonly checkIns: CheckInsService,
  ) {}

  @Get()
  @RequirePermissions('field:read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(FieldListQuery)) q: z.infer<typeof FieldListQuery>,
  ) {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const today = localDate(new Date(), s.timezone);
      const from = q.from ?? q.to ?? today;
      const to = q.to ?? (q.from && q.from > today ? q.from : today);
      if (to < from) throw err(422, 'VALIDATION', 'to is before from');
      const days = dateRange(from, to);
      if (days.length > MAX_RANGE_DAYS)
        throw err(422, 'VALIDATION', `Range is limited to ${MAX_RANGE_DAYS} days`);

      const uw = [
        this.checkIns.userFilter(p, q.userId, users.id),
        sql`${users.deletedAt} is null`,
        eq(users.status, 'active'),
        q.territoryId
          ? inArray(
              users.id,
              tx
                .select({ id: userTerritories.userId })
                .from(userTerritories)
                .where(
                  inArray(
                    userTerritories.territoryId,
                    this.checkIns.territorySubtree(tx, q.territoryId),
                  ),
                ),
            )
          : undefined,
      ].filter(Boolean) as SQL[];
      const team = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(...uw))
        .orderBy(asc(users.name));
      const ids = team.map((u) => u.id);
      const d = capDate(s.timezone);
      const caps = ids.length
        ? await tx
            .select()
            .from(geoCaptures)
            .where(
              and(
                inArray(geoCaptures.userId, ids),
                inArray(geoCaptures.kind, ['punch_in', 'visit', 'punch_out']),
                sql`${d} between ${from}::date and ${to}::date`,
              ),
            )
        : [];
      // Leave/holiday come from the day's DCR work type, else the approved tour plan's first session.
      const dayRows = ids.length
        ? await tx
            .select({
              userId: dcrs.userId,
              date: dcrs.date,
              workTypeId: dcrs.workTypeId,
              kind: workTypes.kind,
            })
            .from(dcrs)
            .innerJoin(workTypes, eq(workTypes.id, dcrs.workTypeId))
            .where(
              and(
                inArray(dcrs.userId, ids),
                sql`${dcrs.date} between ${from} and ${to}`,
                sql`${dcrs.deletedAt} is null`,
              ),
            )
        : [];
      type TpRow = { userId: string; date: string; workTypeId: string; kind: string };
      let tpList: TpRow[] = [];
      if (ids.length) {
        const res = (await tx.execute(sql`
          select s.user_id as "userId", s.date, s.work_type_id as "workTypeId", wt.kind::text as kind
          from plan_sessions s
          join tour_plans tp on tp.user_id = s.user_id and tp.status = 'approved' and tp.deleted_at is null
            and tp.month = date_trunc('month', s.date::date)::date
          join work_types wt on wt.id = s.work_type_id
          where s.deleted_at is null and s.user_id in (${sql.join(
            ids.map((i) => sql`${i}::uuid`),
            sql`, `,
          )})
            and s.date between ${from} and ${to}
          order by s.session_no`)) as unknown as { rows?: TpRow[] } | TpRow[];
        tpList = Array.isArray(res) ? res : (res.rows ?? []);
      }
      const key = (u: string, dt: string) => `${u}|${dt}`;
      const plan = new Map<string, { workTypeId: string; kind: string }>();
      for (const r of tpList)
        if (!plan.has(key(r.userId, r.date))) plan.set(key(r.userId, r.date), r);
      for (const r of dayRows) plan.set(key(r.userId, r.date), r);
      const byDay = new Map<string, typeof caps>();
      for (const c of caps) {
        const k = key(c.userId, localDate(c.capturedAt, s.timezone));
        byDay.set(k, [...(byDay.get(k) ?? []), c]);
      }

      const all: AttendanceDay[] = [];
      for (const dt of [...days].reverse())
        for (const u of team) {
          const c = byDay.get(key(u.id, dt)) ?? [];
          const pin = c.find((x) => x.kind === 'punch_in');
          const pout = c.find((x) => x.kind === 'punch_out');
          const wt = plan.get(key(u.id, dt));
          const status: AttendanceDay['status'] = pin
            ? pout || dt < today
              ? pout
                ? 'present'
                : 'incomplete'
              : 'incomplete'
            : wt?.kind === 'leave'
              ? 'leave'
              : wt?.kind === 'holiday'
                ? 'holiday'
                : 'absent';
          all.push({
            userId: u.id,
            userName: u.name,
            date: dt,
            status,
            punchIn: pin ? toCheckIn(pin, s.timezone) : null,
            punchOut: pout ? toCheckIn(pout, s.timezone) : null,
            visits: c.filter((x) => x.kind === 'visit').length,
            workTypeId: wt?.workTypeId ?? null,
          });
        }
      if (q.sort === 'date') all.reverse();
      const limit = q.limit ?? 50;
      const offset = decodeCursor(q.cursor);
      return {
        items: all.slice(offset, offset + limit),
        nextCursor: offset + limit < all.length ? encodeCursor(offset + limit) : null,
        serverTime: new Date().toISOString(),
        ...(q.includeTotal === 'true' ? { total: all.length } : {}),
      };
    });
  }
}

/** Team directory (gap #3): the caller plus their reporting line; company-wide roles see everyone. */
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly tenant: TenantService,
    private readonly checkIns: CheckInsService,
  ) {}

  @Get()
  @RequirePermissions('me:read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(UserListQuery)) q: z.infer<typeof UserListQuery>,
  ) {
    return this.tenant.run(p, async (tx) => {
      const wide = p.teamUserIds === null || p.roles.includes('system_admin');
      const where = [
        sql`${users.deletedAt} is null`,
        wide ? undefined : inArray(users.id, p.teamUserIds ?? []),
        q.status ? eq(users.status, q.status) : undefined,
        q.managerId ? eq(users.managerId, q.managerId) : undefined,
        q.q
          ? or(
              ilike(users.name, `%${q.q}%`),
              ilike(users.employeeCode, `%${q.q}%`),
              ilike(users.email, `%${q.q}%`),
            )
          : undefined,
        q.role
          ? inArray(
              users.id,
              tx
                .select({ id: userRoles.userId })
                .from(userRoles)
                .innerJoin(roles, eq(roles.id, userRoles.roleId))
                .where(eq(roles.key, q.role)),
            )
          : undefined,
        q.territoryId
          ? inArray(
              users.id,
              tx
                .select({ id: userTerritories.userId })
                .from(userTerritories)
                .where(
                  inArray(
                    userTerritories.territoryId,
                    this.checkIns.territorySubtree(tx, q.territoryId),
                  ),
                ),
            )
          : undefined,
      ].filter(Boolean) as SQL[];
      const sort = q.sort ?? 'name';
      const field = sort.replace(/^-/, '');
      if (!['name', 'employeeCode'].includes(field))
        throw err(422, 'VALIDATION', `Unknown sort field ${field}`);
      const dir = sort.startsWith('-') ? desc : asc;
      const limit = q.limit ?? 50;
      const offset = decodeCursor(q.cursor);
      const rows = await tx
        .select()
        .from(users)
        .where(and(...where))
        .orderBy(dir(field === 'name' ? users.name : users.employeeCode), asc(users.id))
        .limit(limit + 1)
        .offset(offset);
      const page = rows.slice(0, limit);
      const ids = page.map((r) => r.id);
      const rr = ids.length
        ? await tx
            .select({ userId: userRoles.userId, key: roles.key })
            .from(userRoles)
            .innerJoin(roles, eq(roles.id, userRoles.roleId))
            .where(inArray(userRoles.userId, ids))
        : [];
      const tt = ids.length
        ? await tx
            .select({ userId: userTerritories.userId, id: userTerritories.territoryId })
            .from(userTerritories)
            .innerJoin(territories, eq(territories.id, userTerritories.territoryId))
            .where(inArray(userTerritories.userId, ids))
        : [];
      const items: UserSummary[] = page.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        employeeCode: u.employeeCode,
        roles: rr.filter((r) => r.userId === u.id).map((r) => r.key),
        managerId: u.managerId,
        territoryIds: tt.filter((t) => t.userId === u.id).map((t) => t.id),
        status: u.status,
      }));
      const out: Record<string, unknown> = {
        items,
        nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
        serverTime: new Date().toISOString(),
      };
      if (q.includeTotal === 'true') {
        const [t] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(and(...where));
        out.total = t!.n;
      }
      return out;
    });
  }
}
