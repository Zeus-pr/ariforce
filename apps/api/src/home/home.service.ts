import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  ATTENTION_APPROVAL_TYPES,
  HOME_KPIS,
  type MeAttention,
  type MeToday,
  type PlannedDoctors,
} from '@ariforce/contracts';
import type { Tx } from '@ariforce/db';
import { sql, type SQL } from 'drizzle-orm';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { DcrService } from '../dcr/dcr.service';
import { autoCloseOpenPunches } from '../field/auto-punch-out';
import { companySettings, localDate } from '../field/field.util';
import { KpisService } from '../kpis/kpis.service';
import { approvedItemOn } from '../plans/tp-items';

async function rows<T>(tx: Tx, q: SQL): Promise<T[]> {
  const r = await tx.execute(q);
  return ((r as unknown as { rows?: T[] }).rows ?? (r as unknown as T[])) as T[];
}
const n = (v: unknown) => Number(v ?? 0);
const ids = (xs: string[]) =>
  xs.length
    ? sql`array[${sql.join(
        xs.map((i) => sql`${i}::uuid`),
        sql`, `,
      )}]::uuid[]`
    : sql`array[]::uuid[]`;
/** Team members other than the caller; null teamUserIds = company-wide (RLS limits to the tenant). */
const othersSql = (p: Principal, col: SQL) =>
  p.teamUserIds === null
    ? sql`${col} <> ${p.userId}::uuid`
    : sql`${col} = any(${ids(p.teamUserIds.filter((u) => u !== p.userId))})`;
const hasTeam = (p: Principal) =>
  p.teamUserIds === null || p.teamUserIds.some((u) => u !== p.userId);
const SUBJECT: Record<string, (typeof ATTENTION_APPROVAL_TYPES)[number]> = {
  tour_plan: 'tour_plan',
  tour_plan_item: 'tour_plan_item',
  dcr_correction: 'dcr_unlock',
  leave: 'leave',
  expense: 'expense',
  doctor: 'doctor',
};

/** Home screen aggregates (docs: packages/contracts/src/schemas/home.ts). Own data; no extra permission. */
@Injectable()
export class HomeService {
  constructor(
    private readonly tenant: TenantService,
    private readonly dcr: DcrService,
    private readonly kpiEngine: KpisService,
  ) {}

  /** GET /v1/me/attention: one call for the home badges. */
  attention(p: Principal): Promise<MeAttention> {
    return this.tenant.run(p, async (tx) => {
      const me = sql`${p.userId}::uuid`;
      const byType = Object.fromEntries(ATTENTION_APPROVAL_TYPES.map((t) => [t, 0])) as Record<
        (typeof ATTENTION_APPROVAL_TYPES)[number],
        number
      >;
      const appr = await rows<{ t: string; c: number }>(
        tx,
        sql`select ar.entity_type as t, count(*)::int as c
            from approval_requests ar
            join approval_steps s on s.request_id = ar.id and s.step_no = ar.current_step
            where ar.state = 'pending' and ar.requested_by <> ${me}
              and (s.approver_user_id = ${me} or (s.approver_user_id is null
                   and coalesce(ar.payload->'approverIds', '[]'::jsonb) ? ${p.userId}))
            group by 1`,
      );
      for (const r of appr) {
        const k = SUBJECT[r.t];
        if (k) byType[k] += n(r.c);
      }
      const [x] = await rows<Record<string, number>>(
        tx,
        sql`select
          (select count(*) from notifications where user_id = ${me} and read_at is null)::int as unread,
          (select count(*) from exceptions where deleted_at is null and user_id = ${me}
             and status in ('open', 'acknowledged'))::int as mine_open,
          (select count(*) from exceptions where deleted_at is null and user_id = ${me}
             and status in ('open', 'acknowledged') and severity = 'high')::int as mine_high,
          (select count(*) from exceptions where deleted_at is null and ${othersSql(p, sql`user_id`)}
             and status in ('open', 'acknowledged'))::int as team_open,
          (select count(*) from exceptions where deleted_at is null and ${othersSql(p, sql`user_id`)}
             and status in ('open', 'acknowledged') and severity = 'high')::int as team_high,
          (select count(*) from dcrs where deleted_at is null and status = 'submitted'
             and ${othersSql(p, sql`user_id`)})::int as dcr_pending,
          (select count(*) from approval_requests where requested_by = ${me} and state = 'pending')::int as req_pending,
          (select count(*) from approval_requests where requested_by = ${me} and state = 'pending'
             and entity_type = 'dcr_correction')::int as unlock_pending,
          (select count(*) from approval_requests ar join approval_steps s on s.request_id = ar.id
             where ar.requested_by = ${me} and ar.state = 'rejected' and s.decision = 'rejected'
               and s.decided_at > now() - interval '7 days')::int as rejected7,
          (select count(*) from dcrs where deleted_at is null and user_id = ${me} and status = 'draft')::int as drafts,
          (select count(*) from dcrs where deleted_at is null and user_id = ${me} and status = 'rejected')::int as rejected`,
      );
      const team = hasTeam(p);
      return {
        serverTime: new Date().toISOString(),
        notifications: { unread: n(x?.unread) },
        approvals: { total: Object.values(byType).reduce((a, b) => a + b, 0), byType },
        dcrReview:
          team && p.permissions.includes('dcr:review') ? { pending: n(x?.dcr_pending) } : null,
        exceptions: {
          mine: { open: n(x?.mine_open), high: n(x?.mine_high) },
          team:
            team && p.permissions.includes('field:read')
              ? { open: n(x?.team_open), high: n(x?.team_high) }
              : null,
        },
        myRequests: {
          pending: n(x?.req_pending),
          unlockPending: n(x?.unlock_pending),
          rejectedLast7Days: n(x?.rejected7),
        },
        myDcr: { draftsOpen: n(x?.drafts), rejectedOpen: n(x?.rejected) },
      };
    });
  }

  /** GET /v1/me/today: punch, today's tour plan, today's DCR. */
  today(p: Principal): Promise<MeToday> {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const date = localDate(new Date(), s.timezone);
      // Lazy IST midnight close: prior open punches become punch_out when Home loads.
      await autoCloseOpenPunches(tx, {
        companyId: p.companyId,
        userId: p.userId,
        timezone: s.timezone,
        beforeDay: date,
      });
      const me = sql`${p.userId}::uuid`;
      // Prefer open shift: on duty when the latest punch_in is after any punch_out
      // (FIELD_RELAX can allow re-punch-in after out; min/max alone would still say "out").
      const [punch] = await rows<{
        in_at: string | null;
        out_at: string | null;
        last_in: string | null;
        last_out: string | null;
      }>(
        tx,
        sql`select min(captured_at) filter (where kind = 'punch_in')::text as in_at,
                   max(captured_at) filter (where kind = 'punch_out')::text as out_at,
                   max(captured_at) filter (where kind = 'punch_in')::text as last_in,
                   max(captured_at) filter (where kind = 'punch_out')::text as last_out
            from geo_captures where user_id = ${me}
              and (captured_at at time zone ${s.timezone})::date = ${date}::date`,
      );
      const inAt = punch?.in_at ? new Date(punch.in_at).toISOString() : null;
      const outAt = punch?.out_at ? new Date(punch.out_at).toISOString() : null;
      const lastIn = punch?.last_in ? Date.parse(punch.last_in) : 0;
      const lastOut = punch?.last_out ? Date.parse(punch.last_out) : 0;
      const item = await approvedItemOn(tx, p.userId, date);
      const plan = (item?.plan ?? {}) as { workTypeId?: string; territoryIds?: string[] };
      const [wt] = plan.workTypeId
        ? await rows<{ name: string }>(
            tx,
            sql`select name from work_types where id = ${plan.workTypeId}::uuid`,
          )
        : [];
      const [mp] = await rows<{ id: string; status: string; visits: number }>(
        tx,
        sql`select tp.id, tp.status::text as status,
              (select count(*) from tour_plan_visits v where v.tour_plan_id = tp.id and v.date = ${date}::date
                 and v.outlet_kind = 'doctor')::int as visits
            from tour_plans tp where tp.user_id = ${me} and tp.deleted_at is null
              and tp.month = date_trunc('month', ${date}::date)::date`,
      );
      const [d] = await rows<{ id: string; status: string; calls: number }>(
        tx,
        sql`select d.id, d.status::text as status,
              (select count(*) from dcr_calls c where c.dcr_id = d.id)::int as calls
            from dcrs d where d.user_id = ${me} and d.date = ${date}::date and d.deleted_at is null
              and d.status in ('approved', 'submitted', 'draft')
            order by case d.status when 'approved' then 0 when 'submitted' then 1 else 2 end,
                     d.updated_at desc limit 1`,
      );
      const li = d ? await this.dcr.lockInfo(tx, s, p.userId, date) : null;
      return {
        date,
        timezone: s.timezone,
        serverTime: new Date().toISOString(),
        punch: {
          status: !inAt ? 'not_in' : lastIn > lastOut ? 'in' : 'out',
          inAt,
          outAt: lastIn > lastOut ? null : outAt,
        },
        tourPlan: {
          itemId: item?.id ?? null,
          workTypeId: plan.workTypeId ?? null,
          workTypeName: wt?.name ?? null,
          territoryIds: plan.territoryIds ?? [],
          monthPlanId: mp?.id ?? null,
          monthPlanStatus: mp?.status ?? null,
          plannedVisits: n(mp?.visits),
        },
        dcr:
          d && li
            ? {
                id: d.id,
                status: d.status as 'draft' | 'submitted' | 'approved' | 'rejected',
                calls: n(d.calls),
                lockAt: li.lockAt.toISOString(),
                locked: li.locked,
                neverLocks: li.neverLocks,
              }
            : null,
      };
    });
  }

  /** GET /v1/me/planned-doctors?date=: the month plan's doctor visits, then the TP item's territories. */
  plannedDoctors(p: Principal, q: { date?: string }): Promise<PlannedDoctors> {
    return this.tenant.run(p, async (tx) => {
      const s = await companySettings(tx, p);
      const date = q.date ?? localDate(new Date(), s.timezone);
      const me = sql`${p.userId}::uuid`;
      const item = await approvedItemOn(tx, p.userId, date);
      const terr = ((item?.plan ?? {}) as { territoryIds?: string[] }).territoryIds ?? [];
      const [mp] = await rows<{ id: string }>(
        tx,
        sql`select id from tour_plans where user_id = ${me} and deleted_at is null
              and month = date_trunc('month', ${date}::date)::date`,
      );
      const list = await rows<{
        id: string;
        name: string;
        specialty_id: string | null;
        category_id: string | null;
        territory_id: string;
        src: 'tour_plan' | 'tp_item_territory';
        visited: boolean;
        last_call: string | null;
      }>(
        tx,
        sql`with planned as (
              select v.outlet_id as id, 'tour_plan'::text as src, 0 as o from tour_plan_visits v
              where ${mp ? sql`v.tour_plan_id = ${mp.id}::uuid` : sql`false`}
                and v.date = ${date}::date and v.outlet_kind = 'doctor'
              union all
              select d.id, 'tp_item_territory', 1 from doctors d
              where d.deleted_at is null and d.approval_status = 'approved'
                and (d.territory_id = any(${ids(terr)}) or d.local_territory_id = any(${ids(terr)}))),
            pick as (select distinct on (id) id, src, o from planned order by id, o)
            select d.id, d.name, d.specialty_id, d.category_id, d.territory_id, pick.src,
              exists (select 1 from dcr_calls c where c.user_id = ${me} and c.outlet_kind = 'doctor'
                and c.outlet_id = d.id and c.date = ${date}::date) as visited,
              (select max(c.date)::text from dcr_calls c where c.user_id = ${me} and c.outlet_kind = 'doctor'
                and c.outlet_id = d.id and c.date < ${date}::date) as last_call
            from pick join doctors d on d.id = pick.id and d.deleted_at is null
            order by pick.o, d.name limit 500`,
      );
      return {
        date,
        tourPlanId: mp?.id ?? null,
        tpItemId: item?.id ?? null,
        items: list.map((r) => ({
          doctorId: r.id,
          name: r.name,
          specialtyId: r.specialty_id,
          categoryId: r.category_id,
          territoryId: r.territory_id,
          source: r.src,
          visited: !!r.visited,
          lastCallDate: r.last_call,
        })),
      };
    });
  }

  /** GET /v1/me/kpis: month-to-date HOME_KPIS from the KPI engine, self or team, no reports:read. */
  async kpis(p: Principal, q: { scope: 'self' | 'team'; month?: string }) {
    if (q.scope === 'team' && !hasTeam(p)) throw new ForbiddenException('You have no team');
    const today = await this.tenant.run(p, async (tx) =>
      localDate(new Date(), (await companySettings(tx, p)).timezone),
    );
    const month = q.month ?? today.slice(0, 7);
    const from = `${month}-01`;
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);
    const to = month === today.slice(0, 7) ? today : last;
    if (from > today) throw new ForbiddenException('Month is in the future');
    return this.kpiEngine.report(p, { from, to, rollup: q.scope, kpis: [...HOME_KPIS] } as never);
  }
}
