import * as z from 'zod';
import { Id, Timestamp } from './common';

export const ImportEntity = z
  .enum([
    'doctors',
    'chemists',
    'stockists',
    'products',
    'divisions',
    'product_hq',
    'territories',
    'users',
  ])
  .meta({ id: 'ImportEntity' });
export type ImportEntity = z.infer<typeof ImportEntity>;

export const ImportRequest = z
  .object({
    dryRun: z.boolean().default(true).meta({
      description: 'true = validate and detect duplicates only, write nothing (preview)',
    }),
    fileId: Id.nullable()
      .optional()
      .meta({ description: 'Uploaded source file (R2) kept for audit' }),
    fileName: z.string().max(200).optional(),
    onDuplicate: z
      .enum(['skip', 'update', 'error'])
      .default('skip')
      .meta({ description: 'What to do with rows matching an existing record' }),
    rows: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .max(5000)
      .meta({ description: 'Parsed rows keyed by template column (see docs/IMPORT.md)' }),
  })
  .meta({ id: 'ImportRequest' });
export type ImportRequest = z.infer<typeof ImportRequest>;

export const ImportRowStatus = z
  .enum(['valid', 'created', 'updated', 'duplicate', 'skipped', 'error'])
  .meta({ id: 'ImportRowStatus' });

export const ImportRowResult = z
  .object({
    row: z.int().min(1).meta({ description: '1-based row number in the request (sheet row - 1)' }),
    status: ImportRowStatus,
    errors: z.array(
      z.object({ column: z.string().nullable(), code: z.string(), message: z.string() }),
    ),
    id: Id.nullable().meta({ description: 'Created/updated id, or the matched id for duplicates' }),
    duplicateOf: Id.nullable().meta({
      description: 'Existing record matched by the duplicate rule (#26)',
    }),
    duplicateRule: z
      .enum(['registration_no', 'name_pincode', 'gstin', 'drug_license_no', 'code', 'in_file'])
      .nullable(),
  })
  .meta({ id: 'ImportRowResult' });
export type ImportRowResult = z.infer<typeof ImportRowResult>;

export const ImportJob = z
  .object({
    id: Id,
    companyId: Id,
    entity: ImportEntity,
    dryRun: z.boolean(),
    status: z.enum(['validated', 'completed', 'failed']),
    fileName: z.string().nullable(),
    totals: z.object({
      rows: z.int(),
      valid: z.int(),
      created: z.int(),
      updated: z.int(),
      duplicate: z.int(),
      skipped: z.int(),
      error: z.int(),
    }),
    results: z.array(ImportRowResult),
    createdBy: Id,
    createdAt: Timestamp,
  })
  .meta({ id: 'ImportJob' });
export type ImportJob = z.infer<typeof ImportJob>;
