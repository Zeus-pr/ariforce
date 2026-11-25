import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ROLE_NAMES, calendarWorkingDates, type RoleKey } from '@ariforce/contracts';
import type { Tx } from '@ariforce/db';
import { sql, type SQL } from 'drizzle-orm';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { companySettings, localDate } from '../field/field.util';
import { holdsSeat } from '../stock-statements/sales-seat';
import {
  applySales,
  blankFigures,
  headquartersOf,
  patchesOf,
  sumPeople,
  type Figures,
  type HqSheet,
  type MasterFile,
  type PersonLine,
  type Place,
} from './master-layout';
import { masterXlsx } from './master-xlsx';

const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
const avg = (n: number, d: number) => (d ? Math.round((100 * n) / d) / 100 : null);

function ids(list: string[]) {
  if (!list.length) return sql`array[]::uuid[]`;
  return sql`array[${sql.join(
    list.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

async function read<T extends Record<string, unknown>>(tx: Tx, q: SQL): Promise<T[]> {
  const r = await tx.execute(q);
  return ((r as unknown as { rows?: T[] }).rows ?? (r as unknown as T[])) as T[];
}

type UserRow = {
  id: string;
  name: string;
  employee_code: string | null;
  status: string;
  hr_status: string | null;
  manager: string | null;
  role: string | null;
};

type MonthRow = {
  user_id: string;
  field_days: string;
  doctor_calls: string;
  chemist_calls: string;
  dcr_submitted_days: string;
  dcr_on_time_days: string;
  msl_size: string;
  unique_doctors_seen: string;
  frequency_met_doctors: string;
  pob_value: string;
};

@Injectable()
export class MasterExcelService {
  constructor(private readonly tenant: TenantService) {}

  file(p: Principal, month: string, scope: { headquartersId?: string; userId?: string }) {
    return this.tenant.run(p, async (tx) => {
      const settings = await companySettings(tx, p);
      const today = localDate(new Date(), settings.timezone);
      const from = `${month}-01`;
      const [y, mo] = month.split('-').map(Number) as [number, number];
      const to = `${month}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
      if (from > today)
        throw new HttpException(
          { code: 'MONTH_IN_FUTURE', message: 'Choose a month that has already started.' },
          422,
        );
      if (scope.headquartersId && scope.userId)
        throw new HttpException(
          { code: 'VALIDATION', message: 'Choose a headquarters or a person.' },
          422,
        );
      const upto = to < today ? to : today;
      const team = p.teamUserIds;
      const people = await read<UserRow>(
        tx,
        sql`select u.id, u.name, u.employee_code, u.status::text as status, u.hr_status,
                   m.name as manager,
                   (select r.key from user_roles ur join roles r on r.id = ur.role_id
                     where ur.user_id = u.id order by r.rank desc nulls last limit 1) as role
              from users u
              left join users m on m.id = u.manager_id
             where u.deleted_at is null
               ${team ? sql`and u.id = any(${ids(team)})` : sql``}
             order by u.name`,
      );
      const userIds = people.map((u) => u.id);
      const placeScope = p.scopePaths
        ? sql`and (${sql.join(
            p.scopePaths.map(
              (path) => sql`(t.path::text = ${path} or starts_with(t.path::text, ${path} || '.'))`,
            ),
            sql` or `,
          )})`
        : sql``;
      const places = await read<{
        id: string;
        name: string;
        path: string;
        level: string;
        parent_id: string | null;
      }>(
        tx,
        sql`select t.id, t.name, t.path::text as path, t.level::text as level, t.parent_id
              from territories t
             where t.deleted_at is null ${placeScope}
             order by t.name`,
      );
      const tree: Place[] = places.map((row) => ({
        id: row.id,
        name: row.name,
        path: row.path,
        level: row.level,
        parentId: row.parent_id,
      }));
      const posted = userIds.length
        ? await read<{ user_id: string; territory_id: string }>(
            tx,
            sql`select user_id, territory_id from user_territories
                 where user_id = any(${ids(userIds)})`,
          )
        : [];
      const byPlace = new Map(tree.map((place) => [place.id, place]));
      const hqOf = (territoryId: string) => {
        let cur = byPlace.get(territoryId);
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
          if (cur.level === 'headquarter') return cur.id;
          seen.add(cur.id);
          cur = cur.parentId ? byPlace.get(cur.parentId) : undefined;
        }
        return null;
      };
      const onHq = new Map<string, string[]>();
      const pathsByUser = new Map<string, string[]>();
      for (const row of posted) {
        const place = byPlace.get(row.territory_id);
        if (place) {
          const paths = pathsByUser.get(row.user_id) ?? [];
          paths.push(place.path);
          pathsByUser.set(row.user_id, paths);
        }
        const hqId = hqOf(row.territory_id);
        if (!hqId) continue;
        const list = onHq.get(hqId) ?? [];
        if (!list.includes(row.user_id)) list.push(row.user_id);
        onHq.set(hqId, list);
      }

      const stats = await this.stats(tx, userIds, from, upto, `${month}-01`, settings.timezone);
      const sales = await this.sales(tx, tree, `${month}-01`);
      const patches = await this.patches(tx, userIds, from, upto, tree);

      const byUser = new Map(people.map((u) => [u.id, u]));
      const hqs = headquartersOf(tree);
      const sheets: HqSheet[] = hqs.map((hq) => {
        const lines = (onHq.get(hq.id) ?? [])
          .map((id) => byUser.get(id))
          .filter((u): u is UserRow => !!u)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((u) =>
            this.person(u, stats.get(u.id), sales.ofPaths(pathsByUser.get(u.id) ?? [hq.path])),
          );
        const patchLines = patchesOf(tree, hq).map((patch) => ({
          name: patch.name,
          figures: patches.get(patch.id) ?? blankFigures(),
        }));
        const place = sales.ofPaths([hq.path]);
        return {
          id: hq.id,
          name: hq.name,
          people: lines,
          patches: patchLines,
          total: applySales(sumPeople(lines), place),
        };
      });
      const chosen = this.narrow(sheets, scope, sales, pathsByUser, tree);

      const [company] = await read<{ name: string }>(
        tx,
        sql`select name from companies where id = ${p.companyId}::uuid`,
      );
      const [me] = await read<{ name: string }>(
        tx,
        sql`select name from users where id = ${p.userId}::uuid`,
      );
      const monthLabel = new Intl.DateTimeFormat('en-IN', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${month}-01T00:00:00Z`));
      const generatedAt = new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: settings.timezone,
      }).format(new Date());
      const file: MasterFile = {
        company: company?.name ?? '',
        preparedFor: me?.name ?? '',
        monthLabel,
        monthKey: month,
        generatedAt,
        sheets: chosen,
      };
      return masterXlsx(file);
    });
  }

  private narrow(
    sheets: HqSheet[],
    scope: { headquartersId?: string; userId?: string },
    sales: { ofPaths(paths: string[]): PlaceSales },
    pathsByUser: Map<string, string[]>,
    tree: Place[],
  ): HqSheet[] {
    if (scope.headquartersId) {
      const hit = sheets.filter((sheet) => sheet.id === scope.headquartersId);
      if (!hit.length) throw new NotFoundException('Headquarters not found');
      return hit;
    }
    if (scope.userId) {
      const hit = sheets.find((sheet) =>
        sheet.people.some((person) => person.userId === scope.userId),
      );
      if (!hit) throw new NotFoundException('This person is not posted to a headquarters');
      const people = hit.people.filter((person) => person.userId === scope.userId);
      const hq = tree.find((place) => place.id === hit.id);
      const place = sales.ofPaths(pathsByUser.get(scope.userId) ?? (hq ? [hq.path] : []));
      return [{ ...hit, people, total: applySales(sumPeople(people), place) }];
    }
    return sheets;
  }

  private person(user: UserRow, stat: Stat | undefined, sales: PlaceSales): PersonLine {
    const seated = holdsSeat({ status: user.status, hrStatus: user.hr_status });
    const role =
      user.role && user.role in ROLE_NAMES ? ROLE_NAMES[user.role as RoleKey] : (user.role ?? '');
    const figures = applySales(stat?.figures ?? blankFigures(), sales);
    return {
      userId: user.id,
      name: seated ? user.name : 'Vacant',
      code: user.employee_code ?? '',
      role,
      manager: user.manager ?? '',
      figures,
      submittedDays: stat?.submittedDays ?? 0,
      onTimeDays: stat?.onTimeDays ?? 0,
      mslSeen: stat?.mslSeen ?? 0,
      frequencyMet: stat?.frequencyMet ?? 0,
    };
  }

  private async stats(
    tx: Tx,
    userIds: string[],
    from: string,
    upto: string,
    month: string,
    tz: string,
  ) {
    const out = new Map<string, Stat>();
    if (!userIds.length) return out;
    const who = ids(userIds);
    const months = await read<MonthRow>(
      tx,
      sql`select user_id, field_days::text, doctor_calls::text, chemist_calls::text,
                 dcr_submitted_days::text, dcr_on_time_days::text, msl_size::text,
                 unique_doctors_seen::text, frequency_met_doctors::text, pob_value::text
            from kpi_user_month
           where month = ${month}::date and user_id = any(${who})`,
    );
    const calls = await read<{
      user_id: string;
      unique_doctors: string;
      unique_chemists: string;
      stockist_visits: string;
    }>(
      tx,
      sql`select r.user_id,
                 count(distinct c.outlet_id) filter (where c.outlet_kind = 'doctor')::text as unique_doctors,
                 count(distinct c.outlet_id) filter (where c.outlet_kind = 'chemist')::text as unique_chemists,
                 count(*) filter (where c.outlet_kind = 'stockist')::text as stockist_visits
            from dcrs r
            join dcr_calls c on c.dcr_id = r.id and c.deleted_at is null
           where r.deleted_at is null and r.status in ('submitted', 'approved')
             and r.date between ${from}::date and ${upto}::date
             and r.user_id = any(${who})
           group by r.user_id`,
    );
    const work = await read<{ user_id: string; code: string; kind: string; days: string }>(
      tx,
      sql`select r.user_id, upper(wt.code) as code, wt.kind::text as kind, count(distinct r.date)::text as days
            from dcrs r
            join work_types wt on wt.id = r.work_type_id
           where r.deleted_at is null and r.status in ('submitted', 'approved')
             and r.date between ${from}::date and ${upto}::date
             and r.user_id = any(${who})
           group by r.user_id, upper(wt.code), wt.kind`,
    );
    const leave = await read<{ user_id: string; code: string; days: string }>(
      tx,
      sql`select user_id, leave_type_code as code, sum(fraction)::text as days
            from kpi_user_leave_day
           where date between ${from}::date and ${upto}::date and user_id = any(${who})
           group by user_id, leave_type_code`,
    );
    const leaveDays = await read<{ user_id: string; d: string; fraction: string }>(
      tx,
      sql`select user_id, to_char(date, 'YYYY-MM-DD') as d, sum(fraction)::text as fraction
            from kpi_user_leave_day
           where date between ${from}::date and ${upto}::date and user_id = any(${who})
           group by user_id, date`,
    );
    const punches = await read<{ user_id: string; d: string }>(
      tx,
      sql`select user_id, to_char((captured_at at time zone ${tz})::date, 'YYYY-MM-DD') as d
            from geo_captures
           where kind = 'punch_in' and user_id = any(${who})
             and (captured_at at time zone ${tz})::date between ${from}::date and ${upto}::date`,
    );
    const holidays = await read<{ user_id: string; d: string }>(
      tx,
      sql`select r.user_id, to_char(r.date, 'YYYY-MM-DD') as d
            from dcrs r
            join work_types wt on wt.id = r.work_type_id
           where r.deleted_at is null and r.status in ('submitted', 'approved')
             and wt.kind = 'holiday'
             and r.date between ${from}::date and ${upto}::date
             and r.user_id = any(${who})`,
    );
    const tp = await read<{ user_id: string; planned: string; met: string }>(
      tx,
      sql`select user_id, planned_visits::text as planned, planned_visits_met::text as met
            from kpi_tp_adherence_month
           where month = ${month}::date and user_id = any(${who})`,
    );

    const by = (id: string) => {
      const cur = out.get(id) ?? emptyStat();
      out.set(id, cur);
      return cur;
    };
    for (const row of months) {
      const s = by(row.user_id);
      s.figures.fieldDays = num(row.field_days);
      s.figures.doctorVisits = num(row.doctor_calls);
      s.figures.chemistVisits = num(row.chemist_calls);
      s.figures.callAverage = avg(num(row.doctor_calls), num(row.field_days));
      s.figures.chemistAverage = avg(num(row.chemist_calls), num(row.field_days));
      s.figures.msl = num(row.msl_size);
      s.mslSeen = num(row.unique_doctors_seen);
      s.frequencyMet = num(row.frequency_met_doctors);
      s.figures.coverage = pct(s.mslSeen, s.figures.msl ?? 0);
      s.figures.frequency = pct(s.frequencyMet, s.figures.msl ?? 0);
      s.figures.missed =
        (s.figures.msl ?? 0)
          ? pct(Math.max(0, (s.figures.msl ?? 0) - s.mslSeen), s.figures.msl ?? 0)
          : null;
      s.figures.pob = num(row.pob_value);
      s.submittedDays = num(row.dcr_submitted_days);
      s.onTimeDays = num(row.dcr_on_time_days);
    }
    for (const row of calls) {
      const s = by(row.user_id);
      s.figures.uniqueDoctors = num(row.unique_doctors);
      s.figures.uniqueChemists = num(row.unique_chemists);
      s.figures.stockistVisits = num(row.stockist_visits);
    }
    for (const row of work) {
      const s = by(row.user_id);
      const days = num(row.days);
      if (row.code.startsWith('CAMP_')) s.figures.campDays = (s.figures.campDays ?? 0) + days;
      else if (row.code === 'MEETING') s.figures.meetingDays = (s.figures.meetingDays ?? 0) + days;
      else if (row.code === 'TRAINING')
        s.figures.trainingDays = (s.figures.trainingDays ?? 0) + days;
      else if (row.kind !== 'leave' && row.kind !== 'holiday' && !row.code.startsWith('FIELD_'))
        s.figures.otherDays = (s.figures.otherDays ?? 0) + days;
    }
    for (const row of leave) {
      const s = by(row.user_id);
      const days = num(row.days);
      if (row.code === 'CL') s.figures.cl = days;
      else if (row.code === 'SL') s.figures.sl = days;
      else if (row.code === 'EL') s.figures.el = days;
      else if (row.code === 'LOP') s.figures.lop = days;
      else s.figures.otherLeave = (s.figures.otherLeave ?? 0) + days;
    }
    const punched = new Map<string, Set<string>>();
    for (const row of punches) {
      const set = punched.get(row.user_id) ?? new Set<string>();
      set.add(row.d);
      punched.set(row.user_id, set);
    }
    const off = new Map<string, Map<string, number>>();
    for (const row of leaveDays) {
      const map = off.get(row.user_id) ?? new Map<string, number>();
      map.set(row.d, num(row.fraction));
      off.set(row.user_id, map);
    }
    const holiday = new Map<string, Set<string>>();
    for (const row of holidays) {
      const set = holiday.get(row.user_id) ?? new Set<string>();
      set.add(row.d);
      holiday.set(row.user_id, set);
    }
    const plan = new Map(tp.map((row) => [row.user_id, row]));
    const dates = calendarWorkingDates(from, upto);
    for (const id of userIds) {
      const s = by(id);
      let present = 0;
      let absent = 0;
      let holidayDays = 0;
      let offDays = 0;
      for (const day of dates) {
        const leaveFraction = Math.min(1, off.get(id)?.get(day) ?? 0);
        const isHoliday = holiday.get(id)?.has(day) ?? false;
        if (punched.get(id)?.has(day)) present += 1;
        else if (leaveFraction) absent += 1 - leaveFraction;
        else if (isHoliday) holidayDays += 1;
        else absent += 1;
        offDays += Math.min(1, leaveFraction + (isHoliday ? 1 : 0));
      }
      s.figures.present = present;
      s.figures.absent = Math.round(absent * 10) / 10;
      s.figures.holiday = holidayDays;
      s.figures.workingDays = Math.max(0, dates.length - offDays);
      s.figures.dcrCompliance = pct(s.submittedDays, s.figures.workingDays);
      s.figures.dcrOnTime = pct(s.onTimeDays, s.submittedDays);
      const planned = plan.get(id);
      s.figures.tpAdherence = planned ? pct(num(planned.met), num(planned.planned)) : null;
      if (s.figures.fieldDays == null) s.figures.fieldDays = 0;
      for (const key of [
        'cl',
        'sl',
        'el',
        'lop',
        'otherLeave',
        'campDays',
        'meetingDays',
        'trainingDays',
        'otherDays',
        'uniqueDoctors',
        'uniqueChemists',
        'doctorVisits',
        'chemistVisits',
        'stockistVisits',
        'pob',
      ] as const)
        if (s.figures[key] == null) s.figures[key] = 0;
    }
    return out;
  }

  private async sales(tx: Tx, places: Place[], month: string) {
    const rows = places.length
      ? await read<{
          territory_id: string;
          kind: string;
          actual_value: string;
          target_value: string | null;
          ly_value: string | null;
        }>(
          tx,
          sql`select s.territory_id, s.kind, s.actual_value::text, s.target_value::text, s.ly_value::text
                from kpi_sales_month s
                join territories t on t.id = s.territory_id
               where s.month = ${month}::date and t.deleted_at is null`,
        )
      : [];
    const byPlace = new Map(places.map((p) => [p.id, p]));
    return {
      ofPaths(paths: string[]): PlaceSales {
        const seen = new Set<string>();
        let primarySales = 0;
        let primaryTarget: number | null = null;
        let primaryLy: number | null = null;
        let secondarySales = 0;
        let secondaryTarget: number | null = null;
        for (const row of rows) {
          const place = byPlace.get(row.territory_id);
          if (!place) continue;
          const hit = paths.some(
            (path) => place.path === path || place.path.startsWith(`${path}.`),
          );
          if (!hit || seen.has(`${row.territory_id}:${row.kind}`)) continue;
          seen.add(`${row.territory_id}:${row.kind}`);
          if (row.kind === 'primary') {
            primarySales += num(row.actual_value);
            if (row.target_value != null)
              primaryTarget = (primaryTarget ?? 0) + num(row.target_value);
            if (row.ly_value != null) primaryLy = (primaryLy ?? 0) + num(row.ly_value);
          } else if (row.kind === 'secondary') {
            secondarySales += num(row.actual_value);
            if (row.target_value != null)
              secondaryTarget = (secondaryTarget ?? 0) + num(row.target_value);
          }
        }
        return { primarySales, primaryTarget, primaryLy, secondarySales, secondaryTarget };
      },
    };
  }

  private async patches(tx: Tx, userIds: string[], from: string, upto: string, places: Place[]) {
    const out = new Map<string, Figures>();
    const patchIds = new Set(places.filter((p) => p.level === 'territory').map((p) => p.id));
    if (!userIds.length || !patchIds.size) return out;
    const who = ids(userIds);
    const daysByPatch = new Map<string, { doctor: number; chemist: number }>();
    const calls = await read<{
      patch: string;
      kind: string;
      visits: string;
      uniques: string;
      days: string;
    }>(
      tx,
      sql`select patch, kind, count(*)::text as visits, count(distinct outlet_id)::text as uniques,
                 count(distinct date)::text as days
            from (
              select coalesce(doc.local_territory_id, doc.territory_id) as patch, 'doctor'::text as kind,
                     c.outlet_id, r.date
                from dcrs r
                join dcr_calls c on c.dcr_id = r.id and c.deleted_at is null and c.outlet_kind = 'doctor'
                join doctors doc on doc.id = c.outlet_id
               where r.deleted_at is null and r.status in ('submitted', 'approved')
                 and r.date between ${from}::date and ${upto}::date
                 and r.user_id = any(${who})
              union all
              select coalesce(ch.local_territory_id, ch.territory_id), 'chemist', c.outlet_id, r.date
                from dcrs r
                join dcr_calls c on c.dcr_id = r.id and c.deleted_at is null and c.outlet_kind = 'chemist'
                join chemists ch on ch.id = c.outlet_id
               where r.deleted_at is null and r.status in ('submitted', 'approved')
                 and r.date between ${from}::date and ${upto}::date
                 and r.user_id = any(${who})
              union all
              select coalesce(st.local_territory_id, st.territory_id), 'stockist', c.outlet_id, r.date
                from dcrs r
                join dcr_calls c on c.dcr_id = r.id and c.deleted_at is null and c.outlet_kind = 'stockist'
                join stockists st on st.id = c.outlet_id
               where r.deleted_at is null and r.status in ('submitted', 'approved')
                 and r.date between ${from}::date and ${upto}::date
                 and r.user_id = any(${who})
            ) calls
           group by patch, kind`,
    );
    const listed = await read<{ patch: string; n: string }>(
      tx,
      sql`select coalesce(local_territory_id, territory_id) as patch, count(*)::text as n
            from doctors
           where deleted_at is null and approval_status = 'approved'
           group by 1`,
    );
    const pob = await read<{ patch: string; value: string }>(
      tx,
      sql`select patch, coalesce(sum(value), 0)::text as value
            from (
              select coalesce(doc.local_territory_id, doc.territory_id) as patch, p.value
                from dcrs r
                join dcr_calls c on c.dcr_id = r.id and c.deleted_at is null and c.outlet_kind = 'doctor'
                join dcr_call_products p on p.call_id = c.id and p.deleted_at is null and p.kind = 'pob'
                join doctors doc on doc.id = c.outlet_id
               where r.deleted_at is null and r.status in ('submitted', 'approved')
                 and r.date between ${from}::date and ${upto}::date
                 and r.user_id = any(${who})
              union all
              select coalesce(ch.local_territory_id, ch.territory_id), p.value
                from dcrs r
                join dcr_calls c on c.dcr_id = r.id and c.deleted_at is null and c.outlet_kind = 'chemist'
                join dcr_call_products p on p.call_id = c.id and p.deleted_at is null and p.kind = 'pob'
                join chemists ch on ch.id = c.outlet_id
               where r.deleted_at is null and r.status in ('submitted', 'approved')
                 and r.date between ${from}::date and ${upto}::date
                 and r.user_id = any(${who})
            ) lines
           group by patch`,
    );
    const sales = await this.sales(tx, places, from.slice(0, 7) + '-01');
    for (const id of patchIds) out.set(id, blankFigures());
    for (const row of calls) {
      if (!patchIds.has(row.patch)) continue;
      const figures = out.get(row.patch)!;
      const days = daysByPatch.get(row.patch) ?? { doctor: 0, chemist: 0 };
      if (row.kind === 'doctor') {
        figures.doctorVisits = num(row.visits);
        figures.uniqueDoctors = num(row.uniques);
        days.doctor = num(row.days);
      } else if (row.kind === 'chemist') {
        figures.chemistVisits = num(row.visits);
        figures.uniqueChemists = num(row.uniques);
        days.chemist = num(row.days);
      } else {
        figures.stockistVisits = num(row.visits);
      }
      daysByPatch.set(row.patch, days);
    }
    for (const row of listed) {
      if (!patchIds.has(row.patch)) continue;
      const figures = out.get(row.patch)!;
      figures.msl = num(row.n);
      figures.coverage = pct(figures.uniqueDoctors ?? 0, figures.msl);
      figures.missed = figures.msl
        ? pct(Math.max(0, figures.msl - (figures.uniqueDoctors ?? 0)), figures.msl)
        : null;
    }
    for (const row of pob) {
      if (!out.has(row.patch)) continue;
      out.get(row.patch)!.pob = num(row.value);
    }
    for (const [id, figures] of out) {
      const place = places.find((p) => p.id === id);
      if (!place) continue;
      const days = daysByPatch.get(id);
      figures.fieldDays = days?.doctor ?? figures.fieldDays;
      figures.callAverage = avg(figures.doctorVisits ?? 0, days?.doctor ?? 0);
      figures.chemistAverage = avg(figures.chemistVisits ?? 0, days?.chemist ?? 0);
      Object.assign(figures, applySales(figures, sales.ofPaths([place.path])));
    }
    return out;
  }
}

type PlaceSales = {
  primarySales: number;
  primaryTarget: number | null;
  primaryLy: number | null;
  secondarySales: number;
  secondaryTarget: number | null;
};

type Stat = {
  figures: Figures;
  submittedDays: number;
  onTimeDays: number;
  mslSeen: number;
  frequencyMet: number;
};

function emptyStat(): Stat {
  return { figures: blankFigures(), submittedDays: 0, onTimeDays: 0, mslSeen: 0, frequencyMet: 0 };
}

function num(v: string | number | null | undefined) {
  return v == null || v === '' ? 0 : Number(v);
}
