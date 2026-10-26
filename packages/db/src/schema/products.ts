import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { companies, territories, users } from './tenancy';

export const divisions = pgTable(
  'divisions',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    ...syncCols(),
  },
  (t) => [uniqueIndex('divisions_company_code_uq').on(t.companyId, t.code)],
);

export const productForm = pgEnum('product_form', [
  'tablet',
  'capsule',
  'syrup',
  'injection',
  'cream',
  'drops',
  'other',
]);

export const products = pgTable(
  'products',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    brand: text('brand'),
    composition: text('composition'),
    packSize: text('pack_size'),
    form: productForm('form'),
    mrp: numeric('mrp', { precision: 12, scale: 2 }),
    ptr: numeric('ptr', { precision: 12, scale: 2 }),
    pts: numeric('pts', { precision: 12, scale: 2 }),
    isSample: boolean('is_sample').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('products_company_code_uq').on(t.companyId, sql`upper(${t.code})`),
    index('products_division_idx').on(t.companyId, t.divisionId),
  ],
);

/** Division (or one product) promoted in an HQ territory. productId null = whole division. */
export const productHqMappings = pgTable(
  'product_hq_mappings',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    territoryId: uuid('territory_id')
      .notNull()
      .references(() => territories.id),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id),
    productId: uuid('product_id').references(() => products.id),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('product_hq_uq').on(
      t.companyId,
      t.territoryId,
      t.divisionId,
      sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
);

export const importEntity = pgEnum('import_entity', [
  'doctors',
  'chemists',
  'stockists',
  'products',
  'divisions',
  'product_hq',
  'territories',
  'users',
  'sales_actuals',
  'sales_targets',
]);
export const importStatus = pgEnum('import_status', ['validated', 'completed', 'failed']);
export const importRowStatus = pgEnum('import_row_status', [
  'valid',
  'created',
  'updated',
  'duplicate',
  'skipped',
  'error',
]);

/** One Excel/CSV import attempt (dry run or apply). Append-only evidence. */
export const importJobs = pgTable(
  'import_jobs',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    entity: importEntity('entity').notNull(),
    dryRun: boolean('dry_run').notNull(),
    status: importStatus('status').notNull(),
    onDuplicate: text('on_duplicate').notNull().default('skip'),
    fileName: text('file_name'),
    fileKey: text('file_key'),
    idempotencyKey: text('idempotency_key'),
    totals: jsonb('totals')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('import_jobs_company_idx').on(t.companyId, t.createdAt),
    uniqueIndex('import_jobs_idem_uq')
      .on(t.companyId, t.idempotencyKey, t.dryRun)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

export const importRows = pgTable(
  'import_rows',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    jobId: uuid('job_id')
      .notNull()
      .references(() => importJobs.id),
    rowNo: integer('row_no').notNull(),
    status: importRowStatus('status').notNull(),
    raw: jsonb('raw').notNull(),
    errors: jsonb('errors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    entityId: uuid('entity_id'),
    duplicateOf: uuid('duplicate_of'),
    duplicateRule: text('duplicate_rule'),
  },
  (t) => [uniqueIndex('import_rows_job_row_uq').on(t.jobId, t.rowNo)],
);
