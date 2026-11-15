import { Injectable } from '@nestjs/common';
import type {
  Holiday,
  HolidayCopy,
  HolidayCopyResult,
  HolidayCreate,
  HolidayQueryInput,
  HolidayUpdate,
} from '@ariforce/contracts';
import { companyHolidays } from '@ariforce/db';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { AuditService } from '../common/audit.service';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { holidayDate } from './holiday-date';

const isAdmin = (p: Principal) =>
  (p.roles.includes('system_admin') || p.roles.includes('director')) &&
  p.permissions.includes('users:write');

const span = (from: string, to: string) => {
  const [ay, am, ad] = from.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = to.split('-').map(Number) as [number, number, number];
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000;
};

type Row = typeof companyHolidays.$inferSelect;

@Injectable()
export class HolidaysService {
  constructor(
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  private gate(p: Principal) {
    if (!isAdmin(p))
      throw err(403, 'FORBIDDEN', 'Only a director or system admin can edit holidays');
  }

  private dto(r: Row): Holiday {
    return {
      id: r.id,
      date: holidayDate(r.date),
      name: r.name,
      version: r.version,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async list(p: Principal, q: HolidayQueryInput) {
    if (q.year != null && (q.from || q.to))
      throw err(422, 'VALIDATION', 'Choose a year or a date range, not both');
    if (q.year == null && !(q.from && q.to))
      throw err(422, 'VALIDATION', 'Choose a year, or a start and end date');
    if (q.from && q.to && q.to < q.from)
      throw err(422, 'VALIDATION', 'The end date is before the start date');
    if (q.from && q.to && span(q.from, q.to) > 366)
      throw err(422, 'VALIDATION', 'Ask for at most 366 days at a time');
    return this.tenant.run(p, async (tx) => {
      const where = [isNull(companyHolidays.deletedAt)];
      if (q.year != null) {
        where.push(gte(companyHolidays.date, `${q.year}-01-01`));
        where.push(lte(companyHolidays.date, `${q.year}-12-31`));
      } else {
        where.push(gte(companyHolidays.date, q.from!));
        where.push(lte(companyHolidays.date, q.to!));
      }
      const rows = await tx
        .select()
        .from(companyHolidays)
        .where(and(...where))
        .orderBy(companyHolidays.date);
      return { items: rows.map((r) => this.dto(r)) };
    });
  }

  async create(p: Principal, b: HolidayCreate): Promise<Holiday> {
    this.gate(p);
    return this.tenant.run(p, async (tx) => {
      const [dup] = await tx
        .select({ id: companyHolidays.id })
        .from(companyHolidays)
        .where(and(eq(companyHolidays.date, b.date), isNull(companyHolidays.deletedAt)))
        .limit(1);
      if (dup) throw err(409, 'HOLIDAY_DATE_TAKEN', 'That date already has a holiday');
      const [row] = await tx
        .insert(companyHolidays)
        .values({
          id: uuidv7(),
          companyId: p.companyId,
          date: b.date,
          name: b.name.trim(),
        })
        .returning();
      const dto = this.dto(row!);
      await this.audit.record(tx, p, 'holiday.created', {
        entityType: 'company_holiday',
        entityId: dto.id,
        after: { date: dto.date, name: dto.name },
      });
      return dto;
    });
  }

  async update(p: Principal, id: string, b: HolidayUpdate): Promise<Holiday> {
    this.gate(p);
    return this.tenant.run(p, async (tx) => {
      const [before] = await tx
        .select()
        .from(companyHolidays)
        .where(and(eq(companyHolidays.id, id), isNull(companyHolidays.deletedAt)));
      if (!before) throw err(404, 'NOT_FOUND', 'That holiday was not found');
      if (before.version !== b.version)
        throw err(409, 'VERSION_CONFLICT', 'This holiday changed. Reload the month and try again');
      const [row] = await tx
        .update(companyHolidays)
        .set({ name: b.name.trim() })
        .where(and(eq(companyHolidays.id, id), eq(companyHolidays.version, b.version)))
        .returning();
      if (!row)
        throw err(409, 'VERSION_CONFLICT', 'This holiday changed. Reload the month and try again');
      await this.audit.record(tx, p, 'holiday.updated', {
        entityType: 'company_holiday',
        entityId: id,
        before: { name: before.name },
        after: { name: row.name },
      });
      return this.dto(row);
    });
  }

  async remove(p: Principal, id: string): Promise<void> {
    this.gate(p);
    await this.tenant.run(p, async (tx) => {
      const [before] = await tx
        .select()
        .from(companyHolidays)
        .where(and(eq(companyHolidays.id, id), isNull(companyHolidays.deletedAt)));
      if (!before) throw err(404, 'NOT_FOUND', 'That holiday was not found');
      await tx
        .update(companyHolidays)
        .set({ deletedAt: sql`now()` })
        .where(eq(companyHolidays.id, id));
      await this.audit.record(tx, p, 'holiday.deleted', {
        entityType: 'company_holiday',
        entityId: id,
        before: { date: before.date, name: before.name },
      });
    });
  }

  async copy(p: Principal, b: HolidayCopy): Promise<HolidayCopyResult> {
    this.gate(p);
    if (b.fromYear === b.toYear)
      throw err(422, 'VALIDATION', 'Choose a different year to copy into');
    return this.tenant.run(p, async (tx) => {
      const source = await tx
        .select()
        .from(companyHolidays)
        .where(
          and(
            isNull(companyHolidays.deletedAt),
            gte(companyHolidays.date, `${b.fromYear}-01-01`),
            lte(companyHolidays.date, `${b.fromYear}-12-31`),
          ),
        );
      const dest = await tx
        .select({ date: companyHolidays.date })
        .from(companyHolidays)
        .where(
          and(
            isNull(companyHolidays.deletedAt),
            gte(companyHolidays.date, `${b.toYear}-01-01`),
            lte(companyHolidays.date, `${b.toYear}-12-31`),
          ),
        );
      const have = new Set(dest.map((d) => d.date));
      const skipped: HolidayCopyResult['skipped'] = [];
      let copied = 0;
      for (const row of source) {
        const md = row.date.slice(5);
        if (md === '02-29') {
          const leap = new Date(Date.UTC(b.toYear, 1, 29)).getUTCMonth() === 1;
          if (!leap) {
            skipped.push({ date: `${b.toYear}-02-29`, reason: 'That year has no 29 February' });
            continue;
          }
        }
        const date = `${b.toYear}-${md}`;
        if (have.has(date)) {
          skipped.push({ date, reason: 'That date already has a holiday' });
          continue;
        }
        await tx.insert(companyHolidays).values({
          id: uuidv7(),
          companyId: p.companyId,
          date,
          name: row.name,
        });
        have.add(date);
        copied++;
      }
      await this.audit.record(tx, p, 'holiday.copied', {
        entityType: 'company',
        entityId: p.companyId,
        after: { fromYear: b.fromYear, toYear: b.toYear, copied, skipped: skipped.length },
      });
      return { copied, skipped };
    });
  }
}
