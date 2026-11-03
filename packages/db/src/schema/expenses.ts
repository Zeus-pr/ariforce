import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { allowancePlaces } from './allowances';
import { dcrs, tourPlans } from './activity';
import { companies, users } from './tenancy';

/** Monthly expense claim (#52): one per user per month. Amounts are INR numeric(12,2). */
export const expenseClaims = pgTable(
  'expense_claims',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** First day of the month. */
    month: date('month').notNull(),
    status: text('status', { enum: ['draft', 'submitted', 'approved', 'rejected', 'paid'] })
      .notNull()
      .default('draft'),
    total: numeric('total', { precision: 12, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('INR'),
    approvalRequestId: uuid('approval_request_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id),
    decisionComment: text('decision_comment'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidBy: uuid('paid_by').references(() => users.id),
    paymentRef: text('payment_ref'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('expense_claims_user_month_uq').on(t.companyId, t.userId, t.month),
    index('expense_claims_month_idx').on(t.companyId, t.month, t.status),
    check('expense_claims_month_first', sql`extract(day from ${t.month}) = 1`),
  ],
);

export const expenseLines = pgTable(
  'expense_lines',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => expenseClaims.id),
    date: date('date').notNull(),
    category: text('category', {
      enum: ['travel', 'hotel', 'food', 'mileage', 'allowance', 'other'],
    }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    notes: text('notes'),
    mileageKm: numeric('mileage_km', { precision: 8, scale: 2 }),
    dcrId: uuid('dcr_id').references(() => dcrs.id),
    tourPlanId: uuid('tour_plan_id').references(() => tourPlans.id),
    /** manual = entered by the rep; auto = drafted by TA/DA (#39), replaced on re-run. */
    source: text('source', { enum: ['manual', 'auto'] })
      .notNull()
      .default('manual'),
    /** TA/DA snapshot: band, rate id, place id, km, per-km rate. */
    calc: jsonb('calc'),
    allowancePlaceId: uuid('allowance_place_id').references(() => allowancePlaces.id),
    /** What wrote an auto line (0052): POST .../allowances or the DCR-submit auto-draft. */
    autoTrigger: text('auto_trigger', { enum: ['allowances_run', 'dcr_submit'] }),
    /** Set when the day's DCR was rejected after the line was added (0052 flag). */
    dcrRejectedAt: timestamp('dcr_rejected_at', { withTimezone: true }),
    /** Where the line came from (0056): manual, ta_da (TA/DA auto-draft), dcr (DCR expenses). */
    origin: text('origin', { enum: ['manual', 'ta_da', 'dcr'] })
      .notNull()
      .default('manual'),
    /** origin = 'dcr': index of the item in dcrs.expenses (0056). */
    dcrItemIndex: integer('dcr_item_index'),
    ...syncCols(),
  },
  (t) => [
    index('expense_lines_claim_idx').on(t.claimId),
    index('expense_lines_dcr_idx')
      .on(t.companyId, t.dcrId)
      .where(sql`deleted_at IS NULL`),
    // One live auto line per claim, day and category (0052; duplicate pre-check in the migration).
    uniqueIndex('expense_lines_auto_uq')
      .on(t.companyId, t.claimId, t.date, t.category)
      .where(sql`source = 'auto' AND origin <> 'dcr' AND deleted_at IS NULL`),
    // One live DCR line per (DCR, item): a resubmit can never duplicate (0056).
    uniqueIndex('expense_lines_dcr_item_uq')
      .on(t.companyId, t.dcrId, t.dcrItemIndex)
      .where(sql`origin = 'dcr' AND deleted_at IS NULL`),
    check(
      'expense_lines_origin_ck',
      sql`${t.origin} in ('manual','ta_da','dcr') AND (${t.origin} = 'dcr') = (${t.dcrItemIndex} IS NOT NULL) AND (${t.origin} <> 'dcr' OR ${t.dcrId} IS NOT NULL)`,
    ),
    check('expense_lines_source_ck', sql`${t.source} in ('manual','auto')`),
    check(
      'expense_lines_auto_trigger_ck',
      sql`${t.autoTrigger} IS NULL OR ${t.autoTrigger} in ('allowances_run','dcr_submit')`,
    ),
  ],
);

/** Receipt in R2 (purpose expense_receipt). file_key holds only ids, never names or PII. */
export const expenseAttachments = pgTable(
  'expense_attachments',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    lineId: uuid('line_id')
      .notNull()
      .references(() => expenseLines.id),
    fileKey: text('file_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: text('status', { enum: ['pending', 'confirmed'] })
      .notNull()
      .default('pending'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('expense_attachments_key_uq').on(t.fileKey),
    index('expense_attachments_line_idx').on(t.lineId),
  ],
);
