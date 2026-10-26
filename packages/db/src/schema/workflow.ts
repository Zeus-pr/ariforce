import {
  bigint,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { approvalState, workTypes } from './masters';
import { companies, roleKey, users } from './tenancy';

/**
 * Generic approval engine (#17): one request per thing needing approval
 * (tour plan, DCR correction, new doctor, leave, expense, TP deviation).
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    entityType: text('entity_type', {
      enum: ['tour_plan', 'dcr_correction', 'doctor', 'leave', 'expense', 'tp_deviation'],
    }).notNull(),
    entityId: uuid('entity_id').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    state: approvalState('state').notNull().default('pending'),
    currentStep: integer('current_step').notNull().default(1),
    reason: text('reason'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    ...syncCols(),
  },
  (t) => [
    index('approval_requests_entity_idx').on(t.companyId, t.entityType, t.entityId),
    index('approval_requests_state_idx').on(t.companyId, t.state),
  ],
);

/** Ordered approval chain; approver resolved by role in the requester's hierarchy or an explicit user. */
export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id),
    stepNo: integer('step_no').notNull(),
    approverRole: roleKey('approver_role'),
    approverUserId: uuid('approver_user_id').references(() => users.id),
    decision: approvalState('decision').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    comment: text('comment'),
    ...syncCols(),
  },
  (t) => [index('approval_steps_request_idx').on(t.companyId, t.requestId, t.stepNo)],
);

/**
 * Day plan sessions: one row per (user, date, session) so a day can have several work types (#21).
 * Used by tour plans (planned) now; DCR (#10/#22) adds actuals referencing these rows.
 */
export const planSessions = pgTable(
  'plan_sessions',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    date: text('date').notNull(),
    sessionNo: integer('session_no').notNull().default(1),
    workTypeId: uuid('work_type_id')
      .notNull()
      .references(() => workTypes.id),
    territoryId: uuid('territory_id'),
    notes: text('notes'),
    ...syncCols(),
  },
  (t) => [index('plan_sessions_user_date_idx').on(t.companyId, t.userId, t.date)],
);

/** Append-only audit trail. UPDATE/DELETE/TRUNCATE are revoked and blocked by trigger. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    companyId: uuid('company_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_company_at_idx').on(t.companyId, t.at),
    index('audit_log_entity_idx').on(t.companyId, t.entityType, t.entityId),
  ],
);
