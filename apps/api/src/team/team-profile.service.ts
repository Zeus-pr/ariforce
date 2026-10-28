import { Injectable } from '@nestjs/common';
import {
  calendarWorkingDates,
  hierarchyRank,
  KPI_KEYS,
  MIN_MANAGER_RANK,
  PERFORMANCE_MAX_BUCKETS,
  WEEK_KPI_KEYS,
  type KpiKey,
  type PerformanceGranularity,
  TeamMemberChemistPage,
  TeamMemberDoctorPage,
  type TeamOutletQuery,
  type TeamPerformance,
  type TeamProfile,
} from '@ariforce/contracts';
import type { Tx } from '@ariforce/db';
import { sql, type SQL } from 'drizzle-orm';
import type * as z from 'zod';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { companySettings, localDate } from '../field/field.util';
import { KpisService } from '../kpis/kpis.service';
import { profileExceptions } from '../exceptions/exceptions.engine';
import { approvedLeaveDays } from '../leave/leave.util';
import { decodeCursor, encodeCursor } from '../masters/masters.service';
import { TeamService, type Person } from './team.service';
import { dayReportSql, submittedReportSql } from '../dcr/day-report';

type Gran = z.infer<typeof PerformanceGranularity>;
type Range = { granularity?: Gran; from?: string; to?: string };
type Bucket = TeamPerformance['buckets'][number];
type OutletQ = z.output<typeof TeamOutletQuery>;

async function rows<T>(tx: Tx, q: SQL): Promise<T[]> {
  const r = await tx.execute(q);
  return ((r as unknown as { rows?: T[] }).rows ?? (r as unknown as T[])) as T[];
}
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => iso(ms(d) + n * DAY);
const monday = (d: string) => addDays(d, -((new Date(ms(d)).getUTCDay() + 6) % 7));
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
function monthEnd(d: string) {
  const [y, m] = d.split('-').map(Number) as [number, number];
  return iso(Date.UTC(y, m, 0));
}
function addMonths(d: string, n: number) {
  const [y, m] = d.split('-').map(Number) as [number, number];
  return iso(Date.UTC(y, m - 1 + n, 1));
}
function isoWeek(d: string) {
  const t = new Date(ms(d));
  const thu = new Date(t.getTime() + (3 - ((t.getUTCDay() + 6) % 7)) * DAY);
  const y = thu.getUTCFullYear();
  const w =
    1 +
    Math.round(
      (thu.getTime() - Date.UTC(y, 0, 4)) / (7 * DAY) -
        3 / 7 +
        ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7) / 7,
    );
  return `${y}-W${String(w).padStart(2, '0')}`;
}
const pathCond = (col: SQL, paths: string[]) =>
  paths.length
    ? sql`(${sql.join(
        paths.map((s) => sql`(${col} = ${s} or starts_with(${col}, ${s}::text || '.'))`),
        sql` or `,
      )})`
    : sql`false`;

/** Bucket list for a range (snapped to bucket boundaries). Exported for unit tests. */
export function buckets(g: Gran, from: string | undefined, to: string | undefined, today: string) {
  const end = to ?? today;
  const out: { label: string; from: string; to: string }[] = [];
  if (g === 'week') {
    const last = monday(end);
    for (let s = from ? monday(from) : addDays(last, -7 * 7); s <= last; s = addDays(s, 7))
      out.push({ label: isoWeek(s), from: s, to: addDays(s, 6) });
  } else {
    const last = monthStart(end);
    for (let s = from ? monthStart(from) : addMonths(last, -5); s <= last; s = addMonths(s, 1))
      out.push({ label: s.slice(0, 7), from: s, to: monthEnd(s) });
  }
  return out;
}

/**
 * Team member profile (#75). Read-only. Access: own profile for any hierarchy role; others for ABM+
 * with reports:read when the target is strictly below them (Director: everyone). 403/404 per
 * docs/TEAM-PROFILE.md.
 */
@Injectable()
export class TeamProfileService {
  constructor(
    private readonly tenant: TenantService,
    private readonly team: TeamService,
    private readonly kpis: KpisService,
    private readonly audit: AuditService,
  ) {}

  /** Resolves the target or throws 403/404. */
  private async target(tx: Tx, p: Principal, userId: string) {
    const viewerRank = hierarchyRank(p.roles);
    if (viewerRank === 0) throw err(403, 'FORBIDDEN', 'Team profiles need a hierarchy role');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))
      throw err(404, 'NOT_FOUND', 'Team member not found');
    const self = userId === p.userId;
    if (!self && (viewerRank < MIN_MANAGER_RANK || !p.permissions.includes('reports:read')))
      throw err(403, 'FORBIDDEN', 'Only ABM and above with reports:read may view other profiles');
    const all = await this.team.peopleFor(tx);
    const t: Person | undefined = all.get(userId);
    const inScope = self || p.teamUserIds === null || p.teamUserIds.includes(userId);
    if (!t || t.rank === 0 || !inScope) throw err(404, 'NOT_FOUND', 'Team member not found');
    const paths = (
      await rows<{ path: string }>(
        tx,
        sql`select t.path from user_territories ut join territories t on t.id = ut.territory_id
            where ut.user_id = ${userId} and t.deleted_at is null`,
      )
    ).map((r) => r.path);
    const canSeeExpenses =
      self || p.permissions.some((x) => x === 'expenses:approve' || x === 'expenses:pay');
    return { all, t, paths, canSeeExpenses };
  }

  profile(p: Principal, userId: string) {
    return this.tenant.run(p, async (tx): Promise<TeamProfile> => {
      const { all, t, paths, canSeeExpenses } = await this.target(tx, p, userId);
      const s = await companySettings(tx, p);
      const today = localDate(new Date(), s.timezone);
      const node = (await this.team.nodeFor(tx, all, userId))!;
      const { depth: _d, ...member } = node;
      const mgr = t.managerId ? all.get(t.managerId) : undefined;
      const mgrNode = mgr ? await this.team.nodeFor(tx, all, mgr.id) : null;
      const [hq] = await rows<{ id: string }>(
        tx,
        sql`select t.id from user_territories ut join territories t on t.id = ut.territory_id
            where ut.user_id = ${userId} and t.deleted_at is null
            order by length(t.path) - length(replace(t.path, '.', '')) desc, t.name limit 1`,
      );
      const [c] = await rows<{ doctors: string; chemists: string }>(
        tx,
        sql`select (select count(*) from kpi_user_doctor_list where user_id = ${userId}) as doctors,
                   (select count(*) from chemists c join territories t on t.id = c.territory_id
                     where c.deleted_at is null and t.deleted_at is null
                       and ${pathCond(sql`t.path`, paths)}) as chemists`,
      );
      const caps = await rows<{ kind: string; at: Date | string; d: string }>(
        tx,
        sql`select kind::text as kind, captured_at as at, to_char((captured_at at time zone ${s.timezone})::date, 'YYYY-MM-DD') as d
            from geo_captures where user_id = ${userId} and kind in ('punch_in','punch_out')
              and (captured_at at time zone ${s.timezone})::date = ${today}::date order by captured_at`,
      );
      const [last] = await rows<{ at: Date | string | null }>(
        tx,
        sql`select max(captured_at) as at from geo_captures where user_id = ${userId} and kind = 'punch_in'`,
      );
      const lv = (await approvedLeaveDays(tx, [userId], today, today))[0];
      const [dcr] = await rows<{ kind: string }>(
        tx,
        sql`select wt.kind::text as kind from dcrs r join work_types wt on wt.id = r.work_type_id
            where r.user_id = ${userId} and r.date = ${today}::date and r.deleted_at is null
              and ${dayReportSql('r')} limit 1`,
      );
      const ts = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
      const pin = caps.find((x) => x.kind === 'punch_in');
      const pout = caps.find((x) => x.kind === 'punch_out');
      const status: TeamProfile['today']['status'] = pin
        ? pout
          ? 'present'
          : 'incomplete'
        : lv || dcr?.kind === 'leave'
          ? 'leave'
          : dcr?.kind === 'holiday'
            ? 'holiday'
            : calendarWorkingDates(today, today).length
              ? 'absent'
              : 'weekly_off';
      return {
        member,
        manager: mgr ? { id: mgr.id, name: mgr.name, role: mgrNode?.role ?? null } : null,
        hq: member.territories.find((x) => x.id === hq?.id) ?? null,
        counts: {
          doctors: num(c?.doctors),
          chemists: num(c?.chemists),
          directReports: member.directReportCount,
          subtreeSize: this.team.subtreeOf(all, userId).size - 1,
        },
        today: {
          date: today,
          status,
          punchInAt: ts(pin?.at),
          punchOutAt: ts(pout?.at),
          leave: lv ? { requestId: lv.requestId, typeCode: lv.typeCode, half: lv.half } : null,
        },
        lastPunchInAt: ts(last?.at),
        exceptions: p.permissions.includes('field:read')
          ? await profileExceptions(tx, userId, today)
          : null,
        canSeeExpenses,
      };
    });
  }

  /** Performance buckets; also used by the export. */
  performanceData(p: Principal, userId: string, q: Range) {
    return this.tenant.run(p, async (tx) => {
      const { t, canSeeExpenses } = await this.target(tx, p, userId);
      const s = await companySettings(tx, p);
      const today = localDate(new Date(), s.timezone);
      const g: Gran = q.granularity ?? 'month';
      const bs = buckets(g, q.from, q.to, today);
      if (bs.length > PERFORMANCE_MAX_BUCKETS[g])
        throw err(422, 'RANGE_TOO_LONG', `At most ${PERFORMANCE_MAX_BUCKETS[g]} ${g} buckets`, {
          max: PERFORMANCE_MAX_BUCKETS[g],
          requested: bs.length,
        });
      const from = bs[0]!.from;
      const to = bs.at(-1)!.to;
      const upto = to < today ? to : today;
      const keys: KpiKey[] = g === 'week' ? [...WEEK_KPI_KEYS] : [...KPI_KEYS];

      // Attendance inputs for the whole range, then bucketed in memory.
      const punch = new Set(
        (
          await rows<{ d: string }>(
            tx,
            sql`select distinct to_char((captured_at at time zone ${s.timezone})::date, 'YYYY-MM-DD') as d
                from geo_captures where user_id = ${userId} and kind = 'punch_in'
                  and (captured_at at time zone ${s.timezone})::date between ${from}::date and ${upto}::date`,
          )
        ).map((r) => r.d),
      );
      const dcrKind = new Map(
        (
          await rows<{ d: string; kind: string }>(
            tx,
            sql`select to_char(r.date, 'YYYY-MM-DD') as d, wt.kind::text as kind from dcrs r
                join work_types wt on wt.id = r.work_type_id
                where r.user_id = ${userId} and ${submittedReportSql('r')}
                  and r.date between ${from}::date and ${upto}::date`,
          )
        ).map((r) => [r.d, r.kind]),
      );
      const leave = new Map<string, number>();
      for (const l of await approvedLeaveDays(tx, [userId], from, upto))
        leave.set(l.date, Math.max(leave.get(l.date) ?? 0, l.half ? 0.5 : 1));
      const exp = canSeeExpenses
        ? await rows<{ d: string; amount: string; approved: boolean }>(
            tx,
            sql`select to_char(l.date, 'YYYY-MM-DD') as d, l.amount, (c.status in ('approved','paid')) as approved
                from expense_lines l join expense_claims c on c.id = l.claim_id
                where c.user_id = ${userId} and c.deleted_at is null and l.deleted_at is null
                  and c.status in ('submitted','approved','paid')
                  and l.date between ${from}::date and ${to}::date`,
          )
        : null;

      const make = async (label: string, f: string, tt: string): Promise<Bucket> => {
        const m = await this.kpis.userMetrics(tx, userId, f, tt, today, keys);
        const a = { presentDays: 0, leaveDays: 0, holidayDays: 0, absentDays: 0 };
        const end = tt < upto ? tt : upto;
        if (f <= end)
          for (const d of calendarWorkingDates(f, end)) {
            const k = dcrKind.get(d);
            const lv = Math.max(leave.get(d) ?? 0, k === 'leave' ? 1 : 0);
            if (punch.has(d)) {
              a.presentDays += 1;
              a.leaveDays += lv;
            } else if (lv) {
              a.leaveDays += lv;
              a.absentDays += 1 - lv;
            } else if (k === 'holiday') a.holidayDays += 1;
            else a.absentDays += 1;
          }
        const inB = exp?.filter((x) => x.d >= f && x.d <= tt);
        return {
          label,
          from: f,
          to: tt,
          workingDays: m.workingDays,
          metrics: m.metrics,
          attendance: a,
          expenses: inB
            ? {
                claimed: Math.round(inB.reduce((x, y) => x + Number(y.amount), 0) * 100) / 100,
                approved:
                  Math.round(
                    inB.filter((y) => y.approved).reduce((x, y) => x + Number(y.amount), 0) * 100,
                  ) / 100,
              }
            : null,
        };
      };
      const out: Bucket[] = [];
      for (const b of bs) out.push(await make(b.label, b.from, b.to));
      const total = await make('total', from, to);
      const result: TeamPerformance = {
        userId,
        granularity: g,
        from,
        to,
        generatedAt: new Date().toISOString(),
        buckets: out,
        total,
      };
      return { result, name: t.name };
    });
  }

  async performance(p: Principal, userId: string, q: Range) {
    return (await this.performanceData(p, userId, q)).result;
  }

  private outletFilter(paths: string[], q: OutletQ) {
    return sql`${pathCond(sql`t.path`, paths)}
      ${q.q ? sql`and o.name ilike ${'%' + q.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'}` : sql``}
      ${
        q.territoryId
          ? sql`and exists (select 1 from territories x where x.id = ${q.territoryId} and (t.path = x.path or starts_with(t.path, x.path || '.')))`
          : sql``
      }`;
  }

  doctors(p: Principal, userId: string, q: OutletQ) {
    return this.tenant.run(p, async (tx): Promise<z.infer<typeof TeamMemberDoctorPage>> => {
      await this.target(tx, p, userId);
      const s = await companySettings(tx, p);
      const today = localDate(new Date(), s.timezone);
      const limit = q.limit ?? 50;
      const off = decodeCursor(q.cursor);
      const where = sql`l.user_id = ${userId}
        ${q.q ? sql`and o.name ilike ${'%' + q.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%'}` : sql``}
        ${
          q.territoryId
            ? sql`and exists (select 1 from territories x where x.id = ${q.territoryId} and (t.path = x.path or starts_with(t.path, x.path || '.')))`
            : sql``
        }`;
      const r = await rows<Record<string, string | null>>(
        tx,
        sql`select o.id, o.name, o.qualification, sp.name as specialty, dc.name as category,
                   o.territory_id, t.name as territory_name, o.city, l.required_visits,
                   (select count(*) from dcr_day_calls c where c.user_id = ${userId} and c.outlet_kind = 'doctor'
                      and c.outlet_id = o.id and c.deleted_at is null
                      and c.date >= ${monthStart(today)}::date and c.date <= ${today}::date) as visits,
                   (select to_char(max(c.date), 'YYYY-MM-DD') from dcr_day_calls c where c.user_id = ${userId}
                      and c.outlet_kind = 'doctor' and c.outlet_id = o.id and c.deleted_at is null) as last_visit
            from kpi_user_doctor_list l join doctors o on o.id = l.doctor_id
            join territories t on t.id = o.territory_id
            left join specialties sp on sp.id = o.specialty_id
            left join doctor_categories dc on dc.id = o.category_id
            where ${where} order by o.name, o.id limit ${limit + 1} offset ${off}`,
      );
      const total = q.includeTotal
        ? num(
            (
              await rows<{ n: string }>(
                tx,
                sql`select count(*) as n from kpi_user_doctor_list l join doctors o on o.id = l.doctor_id
                    join territories t on t.id = o.territory_id where ${where}`,
              )
            )[0]?.n,
          )
        : undefined;
      return {
        items: r.slice(0, limit).map((x) => ({
          id: x.id!,
          name: x.name!,
          qualification: x.qualification ?? null,
          specialty: x.specialty ?? null,
          category: x.category ?? null,
          territoryId: x.territory_id!,
          territoryName: x.territory_name!,
          city: x.city ?? null,
          requiredVisits: num(x.required_visits),
          visitsThisMonth: num(x.visits),
          lastVisitDate: x.last_visit ?? null,
        })),
        nextCursor: r.length > limit ? encodeCursor(off + limit) : null,
        serverTime: new Date().toISOString(),
        ...(total === undefined ? {} : { total }),
      };
    });
  }

  chemists(p: Principal, userId: string, q: OutletQ) {
    return this.tenant.run(p, async (tx): Promise<z.infer<typeof TeamMemberChemistPage>> => {
      const { paths } = await this.target(tx, p, userId);
      const limit = q.limit ?? 50;
      const off = decodeCursor(q.cursor);
      const where = sql`o.deleted_at is null and t.deleted_at is null and ${this.outletFilter(paths, q)}`;
      const r = await rows<Record<string, string | null>>(
        tx,
        sql`select o.id, o.name, o.territory_id, t.name as territory_name, o.city,
                   (select to_char(max(c.date), 'YYYY-MM-DD') from dcr_day_calls c where c.user_id = ${userId}
                      and c.outlet_kind = 'chemist' and c.outlet_id = o.id and c.deleted_at is null) as last_visit
            from chemists o join territories t on t.id = o.territory_id
            where ${where} order by o.name, o.id limit ${limit + 1} offset ${off}`,
      );
      const total = q.includeTotal
        ? num(
            (
              await rows<{ n: string }>(
                tx,
                sql`select count(*) as n from chemists o join territories t on t.id = o.territory_id where ${where}`,
              )
            )[0]?.n,
          )
        : undefined;
      return {
        items: r.slice(0, limit).map((x) => ({
          id: x.id!,
          name: x.name!,
          territoryId: x.territory_id!,
          territoryName: x.territory_name!,
          city: x.city ?? null,
          lastVisitDate: x.last_visit ?? null,
        })),
        nextCursor: r.length > limit ? encodeCursor(off + limit) : null,
        serverTime: new Date().toISOString(),
        ...(total === undefined ? {} : { total }),
      };
    });
  }

  auditExport(p: Principal, userId: string, q: Range & { format: string }) {
    return this.tenant.run(p, (tx) =>
      this.audit.record(tx, p, 'team_profile.exported', {
        entityType: 'team_profile',
        entityId: userId,
        after: {
          format: q.format,
          granularity: q.granularity ?? 'month',
          from: q.from ?? null,
          to: q.to ?? null,
        },
      }),
    );
  }
}
