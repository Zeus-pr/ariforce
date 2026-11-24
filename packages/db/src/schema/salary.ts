import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { companies, users } from './tenancy';

/** Monthly pay lines that apply from the first of effectiveMonth. Gross for the year is users.ctc. */
export const salaryStructures = pgTable(
  'salary_structures',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    effectiveMonth: date('effective_month').notNull(),
    basicMonthly: integer('basic_monthly').notNull(),
    hraMonthly: integer('hra_monthly').notNull(),
    specialMonthly: integer('special_monthly').notNull(),
    professionalTaxMonthly: integer('professional_tax_monthly').notNull().default(0),
    bonusDeductionMonthly: integer('bonus_deduction_monthly').notNull().default(0),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('salary_structures_user_month_uq')
      .on(t.companyId, t.userId, t.effectiveMonth)
      .where(sql`${t.deletedAt} is null`),
    check('salary_structures_month_ck', sql`extract(day from ${t.effectiveMonth}) = 1`),
    check(
      'salary_structures_amounts_ck',
      sql`${t.basicMonthly} >= 0 and ${t.hraMonthly} >= 0 and ${t.specialMonthly} >= 0 and ${t.professionalTaxMonthly} >= 0 and ${t.bonusDeductionMonthly} >= 0`,
    ),
  ],
);
