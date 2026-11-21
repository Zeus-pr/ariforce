import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  calendarWorkingDates,
  KPI_KEYS,
  type KpiKey,
  type KpiQuery,
  type KpiReport,
  type ProductKpiReport,
} from '@ariforce/contracts';
import type { Tx } from '@ariforce/db';
import { sql, type SQL } from 'drizzle-orm';
import type * as z from 'zod';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { companySettings, localDate } from '../field/field.util';

type Q = z.output<typeof KpiQuery>;
type Metric = KpiReport['rows'][number]['metrics'][number];
interface Group {
  userId: string | null;
  territoryId: string | null;
  label: string;
  users: string[];
  /** Territory paths for sales (subtree); null = whole company. */
  paths: string[] | null;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const arr = (ids: string[]) =>
  sql`array[${sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  )}]::uuid[]`;
const txt = (xs: string[]) =>
  sql`array[${sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  )}]::text[]`;

async function rows<T>(tx: Tx, q: SQL): Promise<T[]> {
  const r = await tx.execute(q);
  return ((r as unknown as { rows?: T[] }).rows ?? (r as unknown as T[])) as T[];
}

function ratio(
  kpi: KpiKey,
  n: number,
  d: number,
  unit: Metric['unit'],
  target: number | null = null,
): Metric {
  const value = d
    ? Math.round(((unit === 'percent' ? 100 : 1) * n * (unit === 'percent' ? 10 : 100)) / d) /
      (unit === 'percent' ? 10 : 100)
    : null;
  return { kpi, value, numerator: n, denominator: d, unit, target };
}
const count = (
  kpi: KpiKey,
  v: number,
  unit: Metric['unit'] = 'count',
  target: number | null = null,
): Metric => ({
  kpi,
  value: v,
  numerator: v,
  denominator: null,
  unit,
  target,
});

/** Target amount of the period, or null while no target is set (a 0 target would read as "no goal"). */
const amount = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Months (first day, YYYY-MM-01) overlapping [from, to]. */
function months(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const end = to.slice(0, 7);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k > end) break;
    out.push(`${k}-01`);
    m += 1;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

@Injectable()
export class KpisService {
  constructor(private readonly tenant: TenantService) {}

  private period(q: Q, today: string) {
    if (q.from || q.to) {
      const from = q.from ?? `${(q.to ?? today).slice(0, 7)}-01`;
      return { from, to: q.to ?? today };
    }
    const m = q.month ?? today.slice(0, 7);
    const [y, mo] = m.split('-').map(Number) as [number, number];
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
  }

  private async teamUsers(tx: Tx, p: Principal) {
    return rows<{ id: string; name: string }>(
      tx,
      sql`select id, name from users where deleted_at is null
          ${p.teamUserIds ? sql`and id = any(${arr(p.teamUserIds)})` : sql``} order by name`,
    );
  }

  private checkUser(p: Principal, userId?: string) {
    if (userId && p.teamUserIds && !p.teamUserIds.includes(userId))
      throw new ForbiddenException('User is outside your team');
  }

  private async groups(tx: Tx, p: Principal, q: Q, from: string, to: string): Promise<Group[]> {
    const team = await this.teamUsers(tx, p);
    const ownPaths = async (userId: string) =>
      (
        await rows<{ path: string }>(
          tx,
          sql`select t.path from user_territories ut join territories t on t.id = ut.territory_id
              where ut.user_id = ${userId} and t.deleted_at is null`,
        )
      ).map((r) => r.path);
    switch (q.rollup) {
      case 'self': {
        const u = q.userId ?? p.userId;
        this.checkUser(p, u);
        const name = team.find((t) => t.id === u)?.name ?? 'Me';
        return [
          { userId: u, territoryId: null, label: name, users: [u], paths: await ownPaths(u) },
        ];
      }
      case 'team':
        return [
          {
            userId: p.userId,
            territoryId: null,
            label: `${team.find((t) => t.id === p.userId)?.name ?? 'Me'} (team)`,
            users: team.map((t) => t.id),
            paths: p.scopePaths,
          },
        ];
      case 'company':
        if (p.teamUserIds) throw new ForbiddenException('Company rollup needs company-wide scope');
        return [
          {
            userId: null,
            territoryId: null,
            label: 'Company',
            users: team.map((t) => t.id),
            paths: null,
          },
        ];
      case 'byUser': {
        let people = team;
        if (q.territoryId) {
          const [place] = await rows<{ path: string }>(
            tx,
            sql`select path from territories where id = ${q.territoryId}::uuid and deleted_at is null`,
          );
          if (!place) throw new NotFoundException('Territory not found');
          const inside = await rows<{ user_id: string }>(
            tx,
            sql`select distinct ut.user_id
                  from user_territories ut
                  join territories t on t.id = ut.territory_id
                 where t.deleted_at is null
                   and (t.path = ${place.path} or starts_with(t.path, ${place.path}::text || '.'))`,
          );
          const allowed = new Set(inside.map((r) => r.user_id));
          people = team.filter((member) => allowed.has(member.id));
        }
        const userIds = people.map((t) => t.id);
        const paths = userIds.length
          ? await rows<{ user_id: string; path: string }>(
              tx,
              sql`select ut.user_id, t.path from user_territories ut
                    join territories t on t.id = ut.territory_id
                   where ut.user_id = any(${arr(userIds)}) and t.deleted_at is null`,
            )
          : [];
        const byUser = new Map<string, string[]>();
        for (const row of paths)
          byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.path]);
        return people.map((t) => ({
          userId: t.id,
          territoryId: null,
          label: t.name,
          users: [t.id],
          paths: byUser.get(t.id) ?? [],
        }));
      }
      case 'byTerritory': {
        const scope = p.scopePaths
          ? sql`and (${sql.join(
              p.scopePaths.map(
                (s) => sql`(t.path = ${s} or starts_with(t.path, ${s}::text || '.'))`,
              ),
              sql` or `,
            )})`
          : sql``;
        const ts = q.territoryId
          ? q.territoryLevel
            ? await rows<{ id: string; name: string; path: string }>(
                tx,
                sql`select t.id, t.name, t.path from territories t
                    join territories p on p.id = ${q.territoryId}::uuid
                    where t.deleted_at is null and p.deleted_at is null ${scope}
                      and t.level = ${q.territoryLevel}
                      and (t.id = p.id or starts_with(t.path, p.path || '.'))
                    order by t.name`,
              )
            : await rows<{ id: string; name: string; path: string }>(
                tx,
                sql`select t.id, t.name, t.path from territories t
                    where t.deleted_at is null ${scope}
                      and (t.id = ${q.territoryId} or t.parent_id = ${q.territoryId})
                    order by (t.id = ${q.territoryId}) desc, t.name`,
              )
          : await rows<{ id: string; name: string; path: string }>(
              tx,
              sql`select t.id, t.name, t.path from territories t
                  where t.deleted_at is null and t.id = any(${arr(p.territoryIds.length ? p.territoryIds : [p.userId])}) order by t.name`,
            );
        if (q.territoryId && !q.territoryLevel && !ts.some((t) => t.id === q.territoryId))
          throw new NotFoundException('Territory not found');
        // A level listing drops the place itself when it has children, so a sum of the rows
        // does not count the place twice. The next-level listing keeps the place, so a
        // headline can show its own total beside its children.
        const list =
          q.territoryLevel && ts.length > 1 ? ts.filter((t) => t.id !== q.territoryId) : ts;
        const ids = team.map((t) => t.id);
        const members =
          list.length && ids.length
            ? await rows<{ group_id: string; user_id: string }>(
                tx,
                sql`with recursive tree as (
                    select t.id as group_id, t.id as node_id
                      from territories t
                     where t.id = any(${arr(list.map((t) => t.id))}) and t.deleted_at is null
                    union all
                    select tree.group_id, c.id
                      from territories c
                      join tree on c.parent_id = tree.node_id
                     where c.deleted_at is null
                  ),
                  filed as (
                    select r.user_id, r.territory_id, r.territory_ids, r.id
                      from dcrs r
                     where r.deleted_at is null
                       and r.status in ('submitted', 'approved')
                       and r.user_id = any(${arr(ids)})
                       and r.date between ${from}::date and ${to}::date
                  )
                  select tree.group_id, ut.user_id
                    from tree
                    join user_territories ut on ut.territory_id = tree.node_id
                   where ut.user_id = any(${arr(ids)})
                  union
                  select tree.group_id, filed.user_id
                    from tree
                    join filed on filed.territory_id = tree.node_id
                       or tree.node_id = any(coalesce(filed.territory_ids, '{}'::uuid[]))
                  union
                  select tree.group_id, filed.user_id
                    from tree
                    join doctors doc on doc.deleted_at is null
                     and (doc.territory_id = tree.node_id or doc.local_territory_id = tree.node_id)
                    join dcr_calls c on c.outlet_id = doc.id
                     and c.outlet_kind = 'doctor' and c.deleted_at is null
                    join filed on filed.id = c.dcr_id
                   group by tree.group_id, filed.user_id`,
              )
            : [];
        const usersByGroup = new Map<string, string[]>();
        for (const row of members)
          usersByGroup.set(row.group_id, [...(usersByGroup.get(row.group_id) ?? []), row.user_id]);
        return list.map((t) => ({
          userId: null,
          territoryId: t.id,
          label: t.name,
          paths: [t.path],
          users: usersByGroup.get(t.id) ?? [],
        }));
      }
    }
  }

  private async metrics(tx: Tx, g: Group, from: string, to: string, today: string, keys: KpiKey[]) {
    const upto = to < today ? to : today;
    const ms = months(from, to);
    const none = !g.users.length;
    const u = none ? sql`array[]::uuid[]` : arr(g.users);
    const pathCond =
      g.paths === null
        ? sql`true`
        : g.paths.length
          ? sql`(${sql.join(
              g.paths.map((s) => sql`(t.path = ${s} or starts_with(t.path, ${s}::text || '.'))`),
              sql` or `,
            )})`
          : sql`false`;
    const here = g.territoryId
      ? sql`with recursive nodes as (
            select id as node_id from territories
             where id = ${g.territoryId}::uuid and deleted_at is null
            union all
            select c.id from territories c
              join nodes on c.parent_id = nodes.node_id
             where c.deleted_at is null
          ), day as (`
      : sql`with day as (`;
    const touched = g.territoryId
      ? sql`and exists (
            select 1 from dcrs r
             where r.user_id = d.user_id and r.date = d.date
               and r.deleted_at is null and r.status in ('submitted', 'approved')
               and (
                 r.territory_id in (select node_id from nodes)
                 or r.territory_ids && (select coalesce(array_agg(node_id), '{}'::uuid[]) from nodes)
                 or (
                   r.territory_id is null
                   and cardinality(coalesce(r.territory_ids, '{}'::uuid[])) = 0
                   and exists (
                     select 1 from user_territories ut
                      where ut.user_id = r.user_id
                        and ut.territory_id in (select node_id from nodes)
                   )
                 )
                 or exists (
                   select 1 from dcr_calls c
                     join doctors doc on doc.id = c.outlet_id and doc.deleted_at is null
                    where c.dcr_id = r.id and c.deleted_at is null and c.outlet_kind = 'doctor'
                      and (doc.territory_id in (select node_id from nodes)
                        or doc.local_territory_id in (select node_id from nodes))
                 )
               )
          )`
      : sql``;
    const [data] = await rows<Record<string, string | null>>(
      tx,
      sql`${here}
            select count(*) filter (where d.field_day) as field_days,
                   coalesce(sum(d.doctor_calls) filter (where d.field_day), 0) as doctor_calls,
                   coalesce(sum(d.chemist_calls) filter (where d.field_day), 0) as chemist_calls,
                   count(*) filter (where d.dcr_submitted) as submitted,
                   count(*) filter (where d.dcr_on_time) as on_time
              from kpi_user_day d
             where d.user_id = any(${u}) and d.date between ${from}::date and ${upto}::date
               ${touched}
          ), off_rows as (
            select user_id, date, 1::numeric as fraction from kpi_user_day
             where work_type_kind in ('leave','holiday') and user_id = any(${u})
               and date between ${from}::date and ${upto}::date
            union all
            select user_id, date, fraction from kpi_user_leave_day
             where user_id = any(${u}) and date between ${from}::date and ${upto}::date
          ), off as (
            select coalesce(sum(fraction), 0) as off_days from (
              select user_id, date, least(sum(fraction), 1) as fraction from off_rows
               group by user_id, date
            ) days_off
          ), listed as (
            select l.doctor_id, max(l.required_visits) as required_visits
              from kpi_user_doctor_list l
             where l.user_id = any(${u})
               ${g.territoryId ? sql`and l.territory_id in (select node_id from nodes)` : sql``}
             group by l.doctor_id
          ), seen_month as (
            select m.doctor_id, m.month, sum(m.visits) as visits
              from kpi_user_doctor_month m
              join listed on listed.doctor_id = m.doctor_id
             where m.user_id = any(${u}) and m.month = any(${txt(ms)}::date[])
             group by m.doctor_id, m.month
          ), monthly as (
            select coalesce(sum(msl), 0) as msl,
                   coalesce(sum(seen), 0) as seen,
                   coalesce(sum(freq), 0) as freq
              from (
                select count(*) as msl,
                       count(*) filter (where coalesce(s.visits, 0) > 0) as seen,
                       count(*) filter (where coalesce(s.visits, 0) >= listed.required_visits) as freq
                  from unnest(${txt(ms)}::date[]) as mo(month)
                  cross join listed
                  left join seen_month s on s.doctor_id = listed.doctor_id and s.month = mo.month
                 group by mo.month
              ) per_month
          ), pob as (
            select coalesce(sum(p.value), 0) as value
              from dcr_day_calls c
              join dcr_call_products p on p.call_id = c.id and p.kind = 'pob' and p.deleted_at is null
             where c.deleted_at is null and c.user_id = any(${u})
               and c.date between ${from}::date and ${to}::date
          ), tp as (
            select coalesce(sum(planned_visits), 0) as planned,
                   coalesce(sum(planned_visits_met), 0) as met
              from kpi_tp_adherence_month
             where user_id = any(${u}) and month = any(${txt(ms)}::date[])
          ), sales as (
            select s.kind, coalesce(sum(s.actual_value), 0) as actual,
                   sum(s.target_value) as target, sum(s.ly_value) as ly
              from kpi_sales_month s join territories t on t.id = s.territory_id
             where s.month = any(${txt(ms)}::date[]) and ${pathCond}
             group by s.kind
          )
          select day.field_days, day.doctor_calls, day.chemist_calls, day.submitted, day.on_time,
                 off.off_days, monthly.msl, monthly.seen, monthly.freq, pob.value as pob_value,
                 tp.planned, tp.met,
                 (select actual from sales where kind = 'primary') as primary_actual,
                 (select target from sales where kind = 'primary') as primary_target,
                 (select ly from sales where kind = 'primary') as primary_ly,
                 (select actual from sales where kind = 'secondary') as secondary_actual,
                 (select target from sales where kind = 'secondary') as secondary_target
            from day cross join off cross join monthly cross join pob cross join tp`,
    );
    const fieldDays = num(data?.field_days);
    const submitted = num(data?.submitted);
    const workingDays = Math.max(
      0,
      g.users.length * calendarWorkingDates(from, upto).length - num(data?.off_days),
    );
    const msl = num(data?.msl);
    const seen = num(data?.seen);
    const all: Record<KpiKey, () => Metric> = {
      call_average: () => ratio('call_average', num(data?.doctor_calls), fieldDays, 'ratio'),
      chemist_call_average: () =>
        ratio('chemist_call_average', num(data?.chemist_calls), fieldDays, 'ratio'),
      coverage_pct: () => ratio('coverage_pct', seen, msl, 'percent'),
      frequency_compliance_pct: () =>
        ratio('frequency_compliance_pct', num(data?.freq), msl, 'percent'),
      missed_doctor_pct: () => ratio('missed_doctor_pct', msl - seen, msl, 'percent'),
      unique_doctors_seen: () => count('unique_doctors_seen', seen),
      doctor_visits_per_day: () =>
        ratio('doctor_visits_per_day', num(data?.doctor_calls), fieldDays, 'ratio'),
      dcr_compliance_pct: () => ratio('dcr_compliance_pct', submitted, workingDays, 'percent'),
      dcr_on_time_pct: () => ratio('dcr_on_time_pct', num(data?.on_time), submitted, 'percent'),
      tp_adherence_pct: () =>
        ratio('tp_adherence_pct', num(data?.met), num(data?.planned), 'percent'),
      msl_size: () => count('msl_size', msl),
      pob_value: () => count('pob_value', num(data?.pob_value), 'inr'),
      pob_achievement_pct: () => ({
        kpi: 'pob_achievement_pct',
        value: null,
        numerator: num(data?.pob_value),
        denominator: null,
        unit: 'percent',
        target: null,
      }),
      primary_sales_value: () =>
        count(
          'primary_sales_value',
          num(data?.primary_actual),
          'inr',
          amount(data?.primary_target),
        ),
      primary_achievement_pct: () =>
        ratio(
          'primary_achievement_pct',
          num(data?.primary_actual),
          num(data?.primary_target),
          'percent',
          100,
        ),
      secondary_sales_value: () =>
        count(
          'secondary_sales_value',
          num(data?.secondary_actual),
          'inr',
          amount(data?.secondary_target),
        ),
      secondary_achievement_pct: () =>
        ratio(
          'secondary_achievement_pct',
          num(data?.secondary_actual),
          num(data?.secondary_target),
          'percent',
          100,
        ),
      growth_vs_ly_pct: () => {
        const ly = num(data?.primary_ly);
        const r = ratio('growth_vs_ly_pct', num(data?.primary_actual) - ly, ly, 'percent');
        return r;
      },
    };
    return { workingDays, metrics: keys.map((k) => all[k]()) };
  }

  /**
   * One person's KPIs for [from, to] (same maths as rollup=self). Caller must already be inside
   * TenantService.run and must have checked scope. Used by the team member profile (#75).
   */
  async userMetrics(
    tx: Tx,
    userId: string,
    from: string,
    to: string,
    today: string,
    keys: KpiKey[],
  ) {
    const paths = (
      await rows<{ path: string }>(
        tx,
        sql`select t.path from user_territories ut join territories t on t.id = ut.territory_id
            where ut.user_id = ${userId} and t.deleted_at is null`,
      )
    ).map((r) => r.path);
    return this.metrics(
      tx,
      { userId, territoryId: null, label: '', users: [userId], paths },
      from,
      to,
      today,
      keys,
    );
  }

  report(p: Principal, q: Q) {
    return this.tenant.run(p, async (tx): Promise<KpiReport> => {
      const s = await companySettings(tx, p);
      const today = localDate(new Date(), s.timezone);
      const { from, to } = this.period(q, today);
      const keys = q.kpis?.length ? q.kpis : [...KPI_KEYS];
      const out: KpiReport['rows'] = [];
      for (const g of await this.groups(tx, p, q, from, to)) {
        const r = await this.metrics(tx, g, from, to, today, keys);
        out.push({ userId: g.userId, territoryId: g.territoryId, label: g.label, ...r });
      }
      return { from, to, rollup: q.rollup, generatedAt: new Date().toISOString(), rows: out };
    });
  }

  products(p: Principal, q: Q) {
    return this.tenant.run(p, async (tx): Promise<ProductKpiReport> => {
      const s = await companySettings(tx, p);
      const today = localDate(new Date(), s.timezone);
      const { from, to } = this.period(q, today);
      this.checkUser(p, q.userId);
      const users = q.userId ? [q.userId] : p.teamUserIds;
      const uf = users ? sql`and k.user_id = any(${arr(users)})` : sql``;
      const [calls] = await rows<{ n: string }>(
        tx,
        sql`select coalesce(sum(doctor_calls),0) as n from kpi_user_day k
            where k.date between ${from}::date and ${to}::date ${uf}`,
      );
      const total = num(calls?.n);
      const r = await rows<Record<string, string>>(
        tx,
        sql`select pr.id, pr.name, sum(k.detailed_calls) as detailed, sum(k.first_position_calls) as first,
                   sum(k.sample_qty) as samples, sum(k.pob_qty) as pob_qty, sum(k.pob_value) as pob_value
            from kpi_product_month k join products pr on pr.id = k.product_id
            where k.month = any(${txt(months(from, to))}::date[]) ${uf}
              ${q.productId ? sql`and pr.id = ${q.productId}` : sql``}
              ${q.divisionId ? sql`and pr.division_id = ${q.divisionId}` : sql``}
            group by pr.id, pr.name order by sum(k.detailed_calls) desc, pr.name`,
      );
      return {
        from,
        to,
        rows: r.map((x) => ({
          productId: x.id!,
          productName: x.name!,
          detailedCalls: num(x.detailed),
          firstPositionCalls: num(x.first),
          detailingSharePct: total ? Math.round((1000 * num(x.detailed)) / total) / 10 : null,
          sampleQty: num(x.samples),
          pobQty: num(x.pob_qty),
          pobValue: num(x.pob_value),
        })),
      };
    });
  }
}
