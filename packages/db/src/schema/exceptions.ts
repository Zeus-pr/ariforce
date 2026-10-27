import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
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
 * Exception rules (#56): per-company overrides of the code defaults (EXCEPTION_RULES in contracts).
 * No row = defaults. docs/EXCEPTIONS.md.
 */
export const exceptionRules = pgTable(
  'exception_rules',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    code: text('code').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    severity: text('severity', { enum: ['low', 'medium', 'high'] }).notNull(),
    threshold: numeric('threshold', { precision: 10, scale: 2 }),
    action: text('action'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('exception_rules_company_code_uq').on(t.companyId, t.code),
    check('exception_rules_severity_ck', sql`${t.severity} in ('low','medium','high')`),
    check('exception_rules_action_len_ck', sql`${t.action} is null or length(${t.action}) <= 500`),
  ],
);

/** One stored exception per (company, user, rule, period). Written by the exceptions.evaluate job. */
export const exceptions = pgTable(
  'exceptions',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ruleCode: text('rule_code').notNull(),
    /** Day rules: the company-local date. Month rules: the 1st of the month. */
    periodDate: date('period_date').notNull(),
    severity: text('severity', { enum: ['low', 'medium', 'high'] }).notNull(),
    status: text('status', { enum: ['open', 'acknowledged', 'resolved', 'dismissed'] })
      .notNull()
      .default('open'),
    value: numeric('value', { precision: 12, scale: 2 }),
    threshold: numeric('threshold', { precision: 10, scale: 2 }),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    assigneeId: uuid('assignee_id').references(() => users.id),
    followUpOn: date('follow_up_on'),
    explanation: text('explanation'),
    explainedAt: timestamp('explained_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    autoResolved: boolean('auto_resolved').notNull().default(false),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('exceptions_dedupe_uq').on(t.companyId, t.userId, t.ruleCode, t.periodDate),
    index('exceptions_company_status_idx').on(t.companyId, t.status, t.periodDate),
    index('exceptions_user_period_idx').on(t.companyId, t.userId, t.periodDate),
    check('exceptions_severity_ck', sql`${t.severity} in ('low','medium','high')`),
    check(
      'exceptions_status_ck',
      sql`${t.status} in ('open','acknowledged','resolved','dismissed')`,
    ),
    check(
      'exceptions_notes_len_ck',
      sql`coalesce(length(${t.explanation}), 0) <= 1000 and coalesce(length(${t.resolutionNote}), 0) <= 1000`,
    ),
  ],
);
