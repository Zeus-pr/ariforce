import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
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
import { doctors, stockists, workTypes } from './masters';
import { products } from './products';
import { sfcRoutes } from './sfc';
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
    /** Canonical plan (TourPlanDay[]); plan_sessions + tour_plan_visits are derived from it on save. */
    days: jsonb('days').$type<unknown[]>().notNull().default([]),
    decisionComment: text('decision_comment'),
    submitterNote: text('submitter_note'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('tour_plans_user_month_uq').on(t.companyId, t.userId, t.month),
    check('tour_plans_month_first', sql`extract(day from ${t.month}) = 1`),
  ],
);

/**
 * Tour plan submission (#86): a set of days of one monthly plan sent for approval together. Each has
 * its own approval request (entity_type tour_plan, entity_id = submission id). A day's status is the
 * status of the latest submission that contains it (draft when none).
 */
export const tourPlanSubmissions = pgTable(
  'tour_plan_submissions',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    tourPlanId: uuid('tour_plan_id')
      .notNull()
      .references(() => tourPlans.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    dates: date('dates').array().notNull(),
    status: docStatus('status').notNull().default('submitted'),
    submitterNote: text('submitter_note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decisionComment: text('decision_comment'),
    ...syncCols(),
  },
  (t) => [
    index('tour_plan_submissions_plan_idx').on(t.companyId, t.tourPlanId),
    check('tour_plan_submissions_dates_ck', sql`cardinality(${t.dates}) >= 1`),
  ],
);

/**
 * Tour plan item (0050): a one-day or from-to plan with the DCR's day fields in `plan` (workTypeId,
 * territoryIds, workWithUserIds, sfcRoutes, details). draft -> submitted (API 'pending', one
 * approval_requests row, entity_type 'tour_plan_item') -> approved | rejected.
 */
export const tourPlanItems = pgTable(
  'tour_plan_items',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    fromDate: date('from_date').notNull(),
    toDate: date('to_date').notNull(),
    status: docStatus('status').notNull().default('draft'),
    plan: jsonb('plan').$type<Record<string, unknown>>().notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decisionComment: text('decision_comment'),
    ...syncCols(),
  },
  (t) => [
    index('tour_plan_items_user_idx').on(t.companyId, t.userId, t.fromDate),
    index('tour_plan_items_status_idx').on(t.companyId, t.status),
    check(
      'tour_plan_items_range_ck',
      sql`${t.toDate} >= ${t.fromDate} AND ${t.toDate} - ${t.fromDate} <= 30`,
    ),
  ],
);

/** Standard tour plan (STP, #20): one weekly-pattern template per user, copied into monthly plans. */
export const standardTourPlans = pgTable(
  'standard_tour_plans',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** StandardTourPlanDay[]: { week 1-5, weekday 1-7 (ISO, Mon=1), entries }. */
    days: jsonb('days').$type<unknown[]>().notNull().default([]),
    ...syncCols(),
  },
  (t) => [uniqueIndex('standard_tour_plans_user_uq').on(t.companyId, t.userId)],
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
    /** All territories worked (territory_id = the first, kept for existing views). */
    territoryIds: uuid('territory_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** The approved monthly TP the day was compared against (#22). */
    tourPlanId: uuid('tour_plan_id').references(() => tourPlans.id),
    /** The approved tour plan item the day was filed from (0050). */
    tourPlanItemId: uuid('tour_plan_item_id').references(() => tourPlanItems.id),
    status: docStatus('status').notNull().default('draft'),
    /** Reason when the day deviates from the approved TP. */
    deviationReason: text('deviation_reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    /** Field day band (0043): hq | ex_hq | outstation; null for non-field days. */
    band: text('band', { enum: ['hq', 'ex_hq', 'outstation'] }),
    /** Non-field details (0043), shape per work type (contracts DcrDetails). */
    details: jsonb('details'),
    /** Day-level Work With (0043): anyone in the company. */
    workWithUserIds: uuid('work_with_user_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    submittedBy: uuid('submitted_by').references(() => users.id),
    /** Idempotency-Key of POST /v1/dcrs/{id}/submit (0043). */
    submitIdempotencyKey: text('submit_idempotency_key'),
    /** Manager review (0048): approve keeps counting; reject excludes the report everywhere. */
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedBy: uuid('rejected_by').references(() => users.id),
    rejectionReason: text('rejection_reason'),
    ...syncCols(),
  },
  (t) => [
    // 0045: several drafts per user and day; at most one live submitted/approved report.
    uniqueIndex('dcrs_user_date_submitted_uq')
      .on(t.companyId, t.userId, t.date)
      .where(sql`status IN ('submitted', 'approved') AND deleted_at IS NULL`),
    index('dcrs_user_date_idx').on(t.companyId, t.userId, t.date),
    uniqueIndex('dcrs_submit_key_uq')
      .on(t.companyId, t.userId, t.submitIdempotencyKey)
      .where(sql`submit_idempotency_key IS NOT NULL`),
    check('dcrs_band_ck', sql`band IS NULL OR band IN ('hq', 'ex_hq', 'outstation')`),
    check('dcrs_details_ck', sql`details IS NULL OR jsonb_typeof(details) = 'object'`),
    check(
      'dcrs_submit_key_ck',
      sql`submit_idempotency_key IS NULL OR length(submit_idempotency_key) BETWEEN 1 AND 200`,
    ),
    check(
      'dcrs_rejected_ck',
      sql`status <> 'rejected' OR (rejected_at IS NOT NULL AND rejected_by IS NOT NULL AND length(rejection_reason) BETWEEN 1 AND 500)`,
    ),
  ],
);

/** One chosen SFC route per HQ involved in a field day (0043); snapshot frozen at submit. */
export const dcrSfcRoutes = pgTable(
  'dcr_sfc_routes',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    dcrId: uuid('dcr_id')
      .notNull()
      .references(() => dcrs.id),
    hqTerritoryId: uuid('hq_territory_id')
      .notNull()
      .references(() => territories.id),
    sfcRouteId: uuid('sfc_route_id')
      .notNull()
      .references(() => sfcRoutes.id),
    snapshot: jsonb('snapshot'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('dcr_sfc_routes_dcr_hq_uq')
      .on(t.companyId, t.dcrId, t.hqTerritoryId)
      .where(sql`deleted_at IS NULL`),
    index('dcr_sfc_routes_route_idx').on(t.companyId, t.sfcRouteId),
    check('dcr_sfc_routes_snapshot_ck', sql`snapshot IS NULL OR jsonb_typeof(snapshot) = 'object'`),
  ],
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
    /** All joint-work users (joint_work_user_id = the first, kept for existing views). */
    jointWorkUserIds: uuid('joint_work_user_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    remarks: text('remarks'),
    /** When the presentation was shown to the doctor (0048); required on submit for detailed doctor calls. */
    presentationOpenedAt: timestamp('presentation_opened_at', { withTimezone: true }),
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

/**
 * RCPA lines on a chemist call (#40, docs/POB-RCPA.md): our product anchors the molecule; a null
 * competitor_brand row counts our own brand. Replaced with the call on every DCR save.
 */
export const dcrCallRcpa = pgTable(
  'dcr_call_rcpa',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    callId: uuid('call_id')
      .notNull()
      .references(() => dcrCalls.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    competitorBrand: text('competitor_brand'),
    competitorCompany: text('competitor_company'),
    quantity: integer('quantity').notNull(),
    prescriptions: integer('prescriptions'),
    doctorId: uuid('doctor_id').references(() => doctors.id),
    ...syncCols(),
  },
  (t) => [
    index('dcr_call_rcpa_call_idx').on(t.companyId, t.callId),
    index('dcr_call_rcpa_product_idx').on(t.companyId, t.productId),
    index('dcr_call_rcpa_doctor_idx').on(t.doctorId),
    index('dcr_call_rcpa_brand_idx').on(t.companyId, sql`lower(${t.competitorBrand})`),
    uniqueIndex('dcr_call_rcpa_line_uq')
      .on(t.callId, t.productId, sql`lower(coalesce(${t.competitorBrand}, ''))`)
      .where(sql`${t.deletedAt} is null`),
    check('dcr_call_rcpa_quantity_ck', sql`${t.quantity} > 0`),
    check('dcr_call_rcpa_rx_ck', sql`${t.prescriptions} is null or ${t.prescriptions} >= 0`),
    check(
      'dcr_call_rcpa_brand_ck',
      sql`(${t.competitorBrand} is null or length(${t.competitorBrand}) between 1 and 100) and (${t.competitorCompany} is null or (${t.competitorBrand} is not null and length(${t.competitorCompany}) between 1 and 100))`,
    ),
  ],
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
