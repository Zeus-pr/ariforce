import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { products } from './products';
import { stockists } from './masters';
import { companies, users } from './tenancy';

/** One stock-and-sales statement per stockist per calendar month. */
export const stockStatements = pgTable(
  'stock_statements',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    stockistId: uuid('stockist_id')
      .notNull()
      .references(() => stockists.id),
    /** First day of the month. */
    month: date('month').notNull(),
    status: text('status', { enum: ['draft', 'pending', 'approved', 'rejected'] })
      .notNull()
      .default('draft'),
    submittedBy: uuid('submitted_by').references(() => users.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvalRequestId: uuid('approval_request_id'),
    decisionComment: text('decision_comment'),
    openingQty: integer('opening_qty').notNull().default(0),
    openingValue: numeric('opening_value', { precision: 14, scale: 2 }).notNull().default('0'),
    purchaseQty: integer('purchase_qty').notNull().default(0),
    purchaseValue: numeric('purchase_value', { precision: 14, scale: 2 }).notNull().default('0'),
    secondaryQty: integer('secondary_qty').notNull().default(0),
    secondaryValue: numeric('secondary_value', { precision: 14, scale: 2 }).notNull().default('0'),
    closingQty: integer('closing_qty').notNull().default(0),
    closingValue: numeric('closing_value', { precision: 14, scale: 2 }).notNull().default('0'),
    frsQty: integer('frs_qty').notNull().default(0),
    frsValue: numeric('frs_value', { precision: 14, scale: 2 }).notNull().default('0'),
    actualSecondary: numeric('actual_secondary', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    awsFileKey: text('aws_file_key'),
    awsContentType: text('aws_content_type'),
    awsSizeBytes: bigint('aws_size_bytes', { mode: 'number' }),
    awsStatus: text('aws_status', { enum: ['pending', 'confirmed'] }),
    ssFileKey: text('ss_file_key'),
    ssContentType: text('ss_content_type'),
    ssSizeBytes: bigint('ss_size_bytes', { mode: 'number' }),
    ssStatus: text('ss_status', { enum: ['pending', 'confirmed'] }),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('stock_statements_stockist_month_uq')
      .on(t.companyId, t.stockistId, t.month)
      .where(sql`${t.deletedAt} is null`),
    index('stock_statements_status_idx').on(t.companyId, t.status, t.month),
    check('stock_statements_month_ck', sql`extract(day from ${t.month}) = 1`),
    check(
      'stock_statements_status_ck',
      sql`${t.status} in ('draft', 'pending', 'approved', 'rejected')`,
    ),
  ],
);

/** One product row. A null opening quantity is blank, not zero. */
export const stockStatementLines = pgTable(
  'stock_statement_lines',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    statementId: uuid('statement_id')
      .notNull()
      .references(() => stockStatements.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    openingQty: integer('opening_qty'),
    /** carried = taken from the previous approved closing and not editable. */
    openingSource: text('opening_source', { enum: ['typed', 'carried'] })
      .notNull()
      .default('typed'),
    purchaseQty: integer('purchase_qty').notNull().default(0),
    secondaryQty: integer('secondary_qty').notNull().default(0),
    frsQty: integer('frs_qty').notNull().default(0),
    pts: numeric('pts', { precision: 12, scale: 2 }),
    productName: text('product_name').notNull(),
    packSize: text('pack_size'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('stock_statement_lines_product_uq')
      .on(t.statementId, t.productId)
      .where(sql`${t.deletedAt} is null`),
    check(
      'stock_statement_lines_qty_ck',
      sql`(${t.openingQty} is null or ${t.openingQty} >= 0) and ${t.purchaseQty} >= 0 and ${t.secondaryQty} >= 0 and ${t.frsQty} >= 0`,
    ),
    check('stock_statement_lines_source_ck', sql`${t.openingSource} in ('typed', 'carried')`),
  ],
);
