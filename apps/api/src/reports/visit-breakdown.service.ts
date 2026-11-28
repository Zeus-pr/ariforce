import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { Tx } from '@ariforce/db';
import { sql, type SQL } from 'drizzle-orm';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { companySettings, localDate } from '../field/field.util';
import { headquartersOf, type Place } from './master-layout';
import {
  visitLines,
  visitSheets,
  type OutletCard,
  type VisitCall,
  type VisitFile,
} from './visit-layout';
import { visitXlsx } from './visit-xlsx';

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

@Injectable()
export class VisitBreakdownService {
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
      const people = await read<{ id: string }>(
        tx,
        sql`select u.id from users u
             where u.deleted_at is null
               ${team ? sql`and u.id = any(${ids(team)})` : sql``}`,
      );
      if (scope.userId && !people.some((person) => person.id === scope.userId))
        throw new NotFoundException('This person is not on your team');
      const userIds = scope.userId ? [scope.userId] : people.map((person) => person.id);
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
      const hqs = headquartersOf(tree);
      if (scope.headquartersId && !hqs.some((hq) => hq.id === scope.headquartersId))
        throw new NotFoundException('Headquarters not found');

      const calls = userIds.length
        ? await read<{
            user_id: string;
            visitor: string;
            outlet_kind: 'doctor' | 'chemist';
            outlet_id: string;
            date: string;
          }>(
            tx,
            sql`select c.user_id, u.name as visitor, c.outlet_kind, c.outlet_id, c.date::text as date
                  from dcrs r
                  join dcr_calls c on c.dcr_id = r.id and c.deleted_at is null
                  join users u on u.id = c.user_id
                 where r.deleted_at is null
                   and r.status in ('submitted', 'approved')
                   and c.outlet_kind in ('doctor', 'chemist')
                   and c.date >= ${from}::date
                   and c.date <= ${upto}::date
                   and c.user_id = any(${ids(userIds)})`,
          )
        : [];
      const doctorIds = [
        ...new Set(
          calls.filter((call) => call.outlet_kind === 'doctor').map((call) => call.outlet_id),
        ),
      ];
      const chemistIds = [
        ...new Set(
          calls.filter((call) => call.outlet_kind === 'chemist').map((call) => call.outlet_id),
        ),
      ];
      const doctors = doctorIds.length
        ? await read<{
            id: string;
            name: string;
            code: string;
            qualification: string | null;
            city: string | null;
            district: string | null;
            phone: string | null;
            territory_id: string;
            territory: string | null;
            specialty: string | null;
            category: string | null;
            required: number | null;
          }>(
            tx,
            sql`select d.id, d.name, d.code, d.qualification, d.city, d.district, d.phone,
                       d.territory_id,
                       coalesce(lt.name, hq.name) as territory,
                       s.name as specialty, cat.name as category,
                       coalesce(d.visits_per_cycle_override, cat.visits_per_cycle) as required
                  from doctors d
                  left join territories lt on lt.id = d.local_territory_id
                  left join territories hq on hq.id = d.territory_id
                  left join specialties s on s.id = d.specialty_id and s.deleted_at is null
                  left join doctor_categories cat on cat.id = d.category_id and cat.deleted_at is null
                 where d.deleted_at is null and d.id = any(${ids(doctorIds)})`,
          )
        : [];
      const chemists = chemistIds.length
        ? await read<{
            id: string;
            name: string;
            code: string;
            city: string | null;
            district: string | null;
            phone: string | null;
            territory_id: string;
            territory: string | null;
          }>(
            tx,
            sql`select c.id, c.name, c.code, c.city, c.district, c.phone, c.territory_id,
                       coalesce(lt.name, hq.name) as territory
                  from chemists c
                  left join territories lt on lt.id = c.local_territory_id
                  left join territories hq on hq.id = c.territory_id
                 where c.deleted_at is null and c.id = any(${ids(chemistIds)})`,
          )
        : [];
      const byPlace = new Map(tree.map((place) => [place.id, place]));
      const hqOf = (territoryId: string) => {
        let current = byPlace.get(territoryId);
        const seen = new Set<string>();
        while (current && !seen.has(current.id)) {
          if (current.level === 'headquarter') return current.id;
          seen.add(current.id);
          current = current.parentId ? byPlace.get(current.parentId) : undefined;
        }
        return null;
      };
      const placeName = (city: string | null, district: string | null) =>
        [city, district].filter(Boolean).join(', ');
      const outlets: OutletCard[] = [
        ...doctors.flatMap((row) => {
          const hqId = hqOf(row.territory_id);
          if (!hqId) return [];
          return [
            {
              id: row.id,
              kind: 'doctor' as const,
              hqId,
              name: row.name,
              code: row.code,
              specialty: row.specialty ?? '',
              category: row.category ?? '',
              qualification: row.qualification ?? '',
              territory: row.territory ?? '',
              city: placeName(row.city, row.district),
              phone: row.phone ?? '',
              required: row.required,
            },
          ];
        }),
        ...chemists.flatMap((row) => {
          const hqId = hqOf(row.territory_id);
          if (!hqId) return [];
          return [
            {
              id: row.id,
              kind: 'chemist' as const,
              hqId,
              name: row.name,
              code: row.code,
              specialty: '',
              category: '',
              qualification: '',
              territory: row.territory ?? '',
              city: placeName(row.city, row.district),
              phone: row.phone ?? '',
              required: null,
            },
          ];
        }),
      ];
      const visitCalls: VisitCall[] = calls.map((call) => ({
        userId: call.user_id,
        visitor: call.visitor,
        kind: call.outlet_kind,
        outletId: call.outlet_id,
        date: call.date.slice(0, 10),
      }));
      const [company] = await read<{ name: string }>(
        tx,
        sql`select name from companies where id = ${p.companyId}::uuid`,
      );
      const [me] = await read<{ name: string }>(
        tx,
        sql`select name from users where id = ${p.userId}::uuid`,
      );
      const file: VisitFile = {
        company: company?.name ?? '',
        preparedFor: me?.name ?? '',
        monthLabel: new Intl.DateTimeFormat('en-IN', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(`${month}-01T00:00:00Z`)),
        monthKey: month,
        generatedAt: new Intl.DateTimeFormat('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: settings.timezone,
        }).format(new Date()),
        sheets: visitSheets(hqs, visitLines(visitCalls, outlets), scope),
      };
      return visitXlsx(file);
    });
  }
}
