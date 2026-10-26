import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { geoCaptures } from './devices';
import { stockists, workTypes } from './masters';
import { products } from './products';
import { companies, territories, users } from './tenancy';

export const docStatus = pgEnum('doc_status', ['draft', 'submitted', 'approved', 'rejected']);
export const outletKind = pgEnum('outlet_kind', ['doctor', 'chemist', 'stockist']);

/** Monthly tour plan (TP) header; days live in plan_sessions, planned calls in tour_plan_visits. */
export const tourPlans = pgTable(
  'tour_plans',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** First day of the month. */
    month: date('month').notNull(),
    status: docStatus('status').notNull().default('draft'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('tour_plans_user_month_uq').on(t.companyId, t.userId, t.month),
    check('tour_plans_month_first', sql`extract(day from ${t.month}) = 1`),
  ],
);

export const tourPlanVisits = pgTable(
  'tour_plan_visits',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    tourPlanId: uuid('tour_plan_id')
      .notNull()
      .references(() => tourPlans.id),
    date: date('date').notNull(),
    outletKind: outletKind('outlet_kind').notNull(),
    outletId: uuid('outlet_id').notNull(),
    ...syncCols(),
  },
  (t) => [index('tour_plan_visits_plan_date_idx').on(t.companyId, t.tourPlanId, t.date)],
);

/** Daily call report header: one per user per date. */
export const dcrs = pgTable(
  'dcrs',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    date: date('date').notNull(),
    workTypeId: uuid('work_type_id')
      .notNull()
      .references(() => workTypes.id),
    territoryId: uuid('territory_id').references(() => territories.id),
    status: docStatus('status').notNull().default('draft'),
    /** Reason when the day deviates from the approved TP. */
    deviationReason: text('deviation_reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    ...syncCols(),
  },
  (t) => [uniqueIndex('dcrs_user_date_uq').on(t.companyId, t.userId, t.date)],
);

export const dcrCalls = pgTable(
  'dcr_calls',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    dcrId: uuid('dcr_id')
      .notNull()
      .references(() => dcrs.id),
    /** Denormalised from the DCR for reporting. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    date: date('date').notNull(),
    outletKind: outletKind('outlet_kind').notNull(),
    outletId: uuid('outlet_id').notNull(),
    calledAt: timestamp('called_at', { withTimezone: true }),
    /** Visit GPS capture (only captured at punch-in, visit, punch-out). */
    geoCaptureId: uuid('geo_capture_id').references(() => geoCaptures.id),
    jointWorkUserId: uuid('joint_work_user_id').references(() => users.id),
    remarks: text('remarks'),
    ...syncCols(),
  },
  (t) => [
    index('dcr_calls_user_date_idx').on(t.companyId, t.userId, t.date),
    index('dcr_calls_outlet_idx').on(t.companyId, t.outletKind, t.outletId),
  ],
);

export const callLineKind = pgEnum('call_line_kind', ['detailed', 'sample', 'pob']);

/** Products detailed (seq = detailing order), samples given, POB (order booked) per call. */
export const dcrCallProducts = pgTable(
  'dcr_call_products',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    callId: uuid('call_id')
      .notNull()
      .references(() => dcrCalls.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    kind: callLineKind('kind').notNull(),
    seq: smallint('seq'),
    quantity: integer('quantity'),
    value: numeric('value', { precision: 14, scale: 2 }),
    stockistId: uuid('stockist_id').references(() => stockists.id),
    ...syncCols(),
  },
  (t) => [index('dcr_call_products_call_idx').on(t.companyId, t.callId)],
);

export const salesKind = pgEnum('sales_kind', ['primary', 'secondary']);

/** Monthly target per territory (HQ) and optional product. productId null = all products. */
export const salesTargets = pgTable(
  'sales_targets',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    territoryId: uuid('territory_id')
      .notNull()
      .references(() => territories.id),
    productId: uuid('product_id').references(() => products.id),
    month: date('month').notNull(),
    kind: salesKind('kind').notNull(),
    quantity: integer('quantity'),
    value: numeric('value', { precision: 14, scale: 2 }).notNull(),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('sales_targets_uq').on(
      t.companyId,
      t.territoryId,
      t.month,
      t.kind,
      sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
);

/** Monthly actual sales (imported from stockist/secondary statements; ERP is out of scope). */
export const salesActuals = pgTable(
  'sales_actuals',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    territoryId: uuid('territory_id')
      .notNull()
      .references(() => territories.id),
    stockistId: uuid('stockist_id').references(() => stockists.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    month: date('month').notNull(),
    kind: salesKind('kind').notNull(),
    quantity: integer('quantity').notNull().default(0),
    freeQuantity: integer('free_quantity').notNull().default(0),
    value: numeric('value', { precision: 14, scale: 2 }).notNull(),
    isReturn: boolean('is_return').notNull().default(false),
    importJobId: uuid('import_job_id'),
    ...syncCols(),
  },
  (t) => [index('sales_actuals_terr_month_idx').on(t.companyId, t.territoryId, t.month, t.kind)],
);
