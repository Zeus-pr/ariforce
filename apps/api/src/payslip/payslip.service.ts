import { Injectable } from '@nestjs/common';
import {
  companyHolidays,
  companies,
  geoCaptures,
  leavePolicies,
  leaveRequests,
  leaveSettings,
  salaryStructures,
  users,
  type Tx,
} from '@ariforce/db';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { err } from '../field/checkins.service';
import { ABSENT_FROM, isAbsentDay, isSunday } from '../field/day-status';
import { localDate } from '../field/field.util';
import { allDates } from '../leave/leave.util';
import { payslipAmounts } from './math';
import { payslipPdf } from './pdf';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export type StructureInput = {
  userId: string;
  effectiveMonth: string;
  basicMonthly: number;
  hraMonthly: number;
  specialMonthly: number;
  professionalTaxMonthly: number;
  bonusDeductionMonthly: number;
};

@Injectable()
export class PayslipService {
  constructor(private readonly tenant: TenantService) {}

  private canManage(p: Principal) {
    return p.permissions.includes('users:write');
  }

  private target(p: Principal, userId?: string) {
    const id = userId && userId !== p.userId ? userId : p.userId;
    if (id !== p.userId && !this.canManage(p))
      throw err(403, 'FORBIDDEN', 'You can download only your own payslip');
    return id;
  }

  slip(p: Principal, year: number, month: number, userId?: string) {
    return this.tenant.run(p, (tx) => this.build(tx, p, year, month, userId));
  }

  async file(p: Principal, year: number, month: number, userId?: string) {
    const slip = await this.slip(p, year, month, userId);
    const pdf = await payslipPdf({ ...slip, month: slip.monthLabel });
    return {
      pdf,
      name: `payslip-${slip.name.replace(/\s+/g, '-')}-${year}-${String(month).padStart(2, '0')}.pdf`,
    };
  }

  saveStructure(p: Principal, b: StructureInput) {
    if (!this.canManage(p)) throw err(403, 'FORBIDDEN', 'Only HR can change a salary structure');
    return this.tenant.run(p, async (tx) => {
      const month = b.effectiveMonth.slice(0, 7) + '-01';
      const gross = (b.basicMonthly + b.hraMonthly + b.specialMonthly) * 12;
      const [existing] = await tx
        .select({ id: salaryStructures.id })
        .from(salaryStructures)
        .where(
          and(
            eq(salaryStructures.userId, b.userId),
            eq(salaryStructures.effectiveMonth, month),
            isNull(salaryStructures.deletedAt),
          ),
        );
      if (existing) {
        await tx
          .update(salaryStructures)
          .set({
            basicMonthly: b.basicMonthly,
            hraMonthly: b.hraMonthly,
            specialMonthly: b.specialMonthly,
            professionalTaxMonthly: b.professionalTaxMonthly,
            bonusDeductionMonthly: b.bonusDeductionMonthly,
          })
          .where(eq(salaryStructures.id, existing.id));
      } else {
        await tx.insert(salaryStructures).values({
          id: uuidv7(),
          companyId: p.companyId,
          userId: b.userId,
          effectiveMonth: month,
          basicMonthly: b.basicMonthly,
          hraMonthly: b.hraMonthly,
          specialMonthly: b.specialMonthly,
          professionalTaxMonthly: b.professionalTaxMonthly,
          bonusDeductionMonthly: b.bonusDeductionMonthly,
        });
      }
      await tx.update(users).set({ ctc: gross }).where(eq(users.id, b.userId));
      return { userId: b.userId, ctc: gross, effectiveMonth: month.slice(0, 7) };
    });
  }

  private async build(tx: Tx, p: Principal, year: number, month: number, userId?: string) {
    if (month < 1 || month > 12) throw err(422, 'VALIDATION', 'Month must be 1 to 12');
    const id = this.target(p, userId);
    const [person] = await tx
      .select({
        id: users.id,
        name: users.name,
        ctc: users.ctc,
        designation: users.designation,
        employeeCode: users.employeeCode,
        joinedOn: users.joinedOn,
        department: users.department,
        branch: users.branch,
        pfAccount: users.pfAccount,
        esiNumber: users.esiNumber,
      })
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (!person) throw err(404, 'NOT_FOUND', 'Person not found');
    if (person.ctc == null)
      throw err(409, 'NO_CTC', 'Salary is not loaded for this person yet', { userId: id });

    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const [structure] = await tx
      .select()
      .from(salaryStructures)
      .where(
        and(
          eq(salaryStructures.userId, id),
          lte(salaryStructures.effectiveMonth, from),
          isNull(salaryStructures.deletedAt),
        ),
      )
      .orderBy(desc(salaryStructures.effectiveMonth))
      .limit(1);

    const basic = structure?.basicMonthly ?? 0;
    const hra = structure?.hraMonthly ?? 0;
    const special = structure?.specialMonthly ?? Math.round(person.ctc / 12) - basic - hra;
    const [company] = await tx
      .select({ name: companies.name, timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, p.companyId));
    const tz = company?.timezone ?? 'Asia/Kolkata';
    const today = localDate(new Date(), tz);
    const to = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
    const dates = allDates(from, to);
    const [settings] = await tx
      .select({ weeklyOffDays: leaveSettings.weeklyOffDays })
      .from(leaveSettings)
      .where(eq(leaveSettings.companyId, p.companyId));
    const weeklyOff = new Set(settings?.weeklyOffDays ?? [0]);
    const holidays = new Set(
      (
        await tx
          .select({ date: companyHolidays.date })
          .from(companyHolidays)
          .where(
            and(
              isNull(companyHolidays.deletedAt),
              sql`${companyHolidays.date} between ${from}::date and ${to}::date`,
            ),
          )
      ).map((r) => String(r.date).slice(0, 10)),
    );
    const punches = new Set(
      (
        await tx
          .select({
            date: sql<string>`to_char((${geoCaptures.capturedAt} at time zone ${tz})::date, 'YYYY-MM-DD')`,
          })
          .from(geoCaptures)
          .where(
            and(
              eq(geoCaptures.userId, id),
              eq(geoCaptures.kind, 'punch_in'),
              sql`(${geoCaptures.capturedAt} at time zone ${tz})::date between ${from}::date and ${to}::date`,
            ),
          )
      ).map((r) => r.date),
    );
    const leaveRows = await tx
      .select({
        status: leaveRequests.status,
        half: leaveRequests.half,
        fromDate: sql<string>`to_char(${leaveRequests.fromDate}, 'YYYY-MM-DD')`,
        toDate: sql<string>`to_char(${leaveRequests.toDate}, 'YYYY-MM-DD')`,
        paid: leavePolicies.paid,
      })
      .from(leaveRequests)
      .innerJoin(leavePolicies, eq(leavePolicies.id, leaveRequests.policyId))
      .where(
        and(
          eq(leaveRequests.userId, id),
          isNull(leaveRequests.deletedAt),
          sql`${leaveRequests.status} in ('approved', 'pending')`,
          sql`${leaveRequests.fromDate} <= ${to}::date`,
          sql`${leaveRequests.toDate} >= ${from}::date`,
        ),
      );
    let lopDays = 0;
    let absentDays = 0;
    for (const date of dates) {
      if (date >= today) continue;
      const off = weeklyOff.has(new Date(`${date}T00:00:00Z`).getUTCDay()) || isSunday(date);
      const covering = leaveRows.filter(
        (row) => row.fromDate <= date && row.toDate >= date && !off,
      );
      const lop = covering.find((row) => row.status === 'approved' && !row.paid);
      if (lop) {
        lopDays += lop.half ? 0.5 : 1;
        continue;
      }
      if (covering.length) continue;
      if (
        isAbsentDay({
          date,
          today,
          punchedIn: punches.has(date),
          leave: false,
          holiday: holidays.has(date),
        })
      )
        absentDays += 1;
    }
    const amounts = payslipAmounts({
      basic,
      hra,
      special: Math.max(0, special),
      professionalTax: structure?.professionalTaxMonthly ?? 0,
      bonusDeduction: structure?.bonusDeductionMonthly ?? 0,
      totalDays: dates.length,
      unpaidDays: lopDays + absentDays,
    });
    const slip = {
      company: company?.name || 'ARIGHNA PHARMA PVT. LTD.',
      name: person.name,
      designation: person.designation,
      employeeCode: person.employeeCode,
      joinedOn: person.joinedOn ? String(person.joinedOn).slice(0, 10) : null,
      department: person.department,
      branch: person.branch,
      pfAccount: person.pfAccount,
      esiNumber: person.esiNumber,
      fixedBasic: basic,
      fixedHra: hra,
      fixedSpecial: Math.max(0, special),
      year,
      month,
      monthLabel: `${MONTHS[month - 1]} ${year}`,
      totalDays: dates.length,
      unpaidDays: lopDays + absentDays,
      absentDays,
      lopDays,
      hasStructure: !!structure,
      ctc: person.ctc,
      ...amounts,
    };
    return slip;
  }
}
