import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { companies, users } from './tenancy';

/**
 * Leave (#51). Policy is data, not code: one leave_settings row per company and one leave_policies
 * row per leave type per company (defaults inserted by migration 0023 and lazily by the API).
 */
export const leaveSettings = pgTable(
  'leave_settings',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    /** Approval levels up the reporting line (1 = manager only, 2 = manager then their manager). */
    approvalLevels: integer('approval_levels').notNull().default(2),
    /** How many days back a leave may start (0 = today or later). */
    backdateDays: integer('backdate_days').notNull().default(7),
    /** Days not counted as leave (0 = Sunday .. 6 = Saturday). */
    weeklyOffDays: integer('weekly_off_days').array().notNull().default(sql`'{0}'::int[]`),
    /** Latest start relative to today; null = up to 31 Dec of the current year. */
    maxFutureDays: integer('max_future_days'),
    ...syncCols(),
  },
  (t) => [uniqueIndex('leave_settings_company_uq').on(t.companyId)],
);

export const leavePolicies = pgTable(
  'leave_policies',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    paid: boolean('paid').notNull().default(true),
    /** Days per calendar year; null = unlimited (LOP). */
    annualQuota: numeric('annual_quota', { precision: 5, scale: 1 }),
    carryForward: boolean('carry_forward').notNull().default(false),
    /** Max days carried into the next year; null = no cap. */
    carryForwardCap: numeric('carry_forward_cap', { precision: 5, scale: 1 }),
    halfDayAllowed: boolean('half_day_allowed').notNull().default(true),
    /** Balance comes only from grants (comp-off). */
    grantOnly: boolean('grant_only').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...syncCols(),
  },
  (t) => [uniqueIndex('leave_policies_code_uq').on(t.companyId, t.code)],
);

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => leavePolicies.id),
    year: integer('year').notNull(),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    /** Half day (am/pm); only when from_date = to_date. */
    half: text('half', { enum: ['am', 'pm'] }),
    days: numeric('days', { precision: 5, scale: 1 }).notNull(),
    reason: text('reason'),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'cancelled'] })
      .notNull()
      .default('pending'),
    approvalRequestId: uuid('approval_request_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decisionComment: text('decision_comment'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => users.id),
    cancelReason: text('cancel_reason'),
    ...syncCols(),
  },
  (t) => [
    index('leave_requests_user_idx').on(t.companyId, t.userId, t.fromDate),
    index('leave_requests_status_idx').on(t.companyId, t.status, t.fromDate),
    check('leave_requests_range_ck', sql`${t.toDate} >= ${t.fromDate}`),
  ],
);

/** Balance credits/debits outside the annual quota: opening, carry-forward, comp-off grant, adjustment. */
export const leaveGrants = pgTable(
  'leave_grants',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => leavePolicies.id),
    year: integer('year').notNull(),
    kind: text('kind', { enum: ['opening', 'carry_forward', 'grant', 'adjustment'] }).notNull(),
    days: numeric('days', { precision: 5, scale: 1 }).notNull(),
    workedDate: date('worked_date'),
    reason: text('reason'),
    grantedBy: uuid('granted_by').references(() => users.id),
    ...syncCols(),
  },
  (t) => [index('leave_grants_user_idx').on(t.companyId, t.userId, t.year)],
);
