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
    fileKey: z.string().max(300).nullable().optional().meta({
      description:
        'fileKey from POST /v1/files/upload-url with purpose import_source (source sheet kept in R2 for audit)',
    }),
    fileName: z.string().max(200).optional(),
    onDuplicate: z
      .enum(['skip', 'update', 'error'])
      .default('skip')
      .meta({ description: 'What to do with rows matching an existing record' }),
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000).meta({
      description:
        'Parsed rows keyed by the snake_case template columns with master codes (docs/IMPORT.md). Aliases: camelCase keys and create-schema *_id UUIDs.',
    }),
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
    fileKey: z.string().nullable(),
    onDuplicate: z.enum(['skip', 'update', 'error']),
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

// ---- Territory link import (docs/TERRITORY-MODEL.md, docs/IMPORT.md) ----

export const TerritoryLinkImportRequest = z
  .object({
    dryRun: z.boolean().default(true).meta({
      description:
        'true (default) = plan only: resolve HQs, match doctors/chemists, list territories that would be created; nothing is written',
    }),
    fileKey: z.string().max(300).nullable().optional().meta({
      description: 'fileKey from POST /v1/files/upload-url with purpose import_source (audit)',
    }),
    fileName: z.string().max(200).optional(),
    onLinked: z.enum(['keep', 'replace']).default('keep').meta({
      description:
        'A matched row already linked to a DIFFERENT territory: keep (default, reported as skipped/linked_elsewhere) or replace the link',
    }),
    rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000).meta({
      description:
        'Rows keyed hq_code, entity (doctor|chemist), name_key, territory_text (camelCase and header spacing/case accepted; aliases: hq, name, territory)',
    }),
  })
  .meta({ id: 'TerritoryLinkImportRequest' });
export type TerritoryLinkImportRequest = z.infer<typeof TerritoryLinkImportRequest>;

export const TerritoryLinkRowStatus = z
  .enum(['linked', 'already_linked', 'skipped', 'unmatched', 'error'])
  .meta({
    id: 'TerritoryLinkRowStatus',
    description:
      'linked = local_territory_id set (dry run: would be set); already_linked = no change; skipped / unmatched / error: see reason',
  });
export type TerritoryLinkRowStatus = z.infer<typeof TerritoryLinkRowStatus>;

export const TerritoryLinkReason = z
  .enum([
    'unknown_hq',
    'not_headquarter',
    'no_match',
    'ambiguous',
    'blank_territory',
    'linked_elsewhere',
    'duplicate_in_file',
    'conflict_in_file',
    'invalid_entity',
    'blank_name',
    'blank_hq',
    'save_failed',
  ])
  .meta({
    id: 'TerritoryLinkReason',
    description:
      'unmatched: unknown_hq (code not found), not_headquarter (code is not an HQ), no_match (no doctor/chemist with that name under the HQ), ambiguous (several; see candidateIds). skipped: blank_territory, linked_elsewhere (onLinked keep), duplicate_in_file. error: conflict_in_file (same HQ + entity + name with different territories), invalid_entity, blank_name, blank_hq, save_failed',
  });
export type TerritoryLinkReason = z.infer<typeof TerritoryLinkReason>;

export const TerritoryLinkRowResult = z
  .object({
    row: z.int().min(1).meta({ description: '1-based row number in the request' }),
    status: TerritoryLinkRowStatus,
    reason: TerritoryLinkReason.nullable(),
    message: z.string().nullable(),
    entity: z.enum(['doctor', 'chemist']).nullable(),
    hqCode: z.string().nullable(),
    territoryKey: z.string().nullable().meta({
      description: 'Normalised territory text (lower case, non-alphanumerics -> one space)',
    }),
    entityId: Id.nullable().meta({ description: 'Matched doctor/chemist' }),
    territoryId: Id.nullable().meta({
      description: 'Target territory (null in a dry run when it would be created)',
    }),
    territoryCode: z.string().nullable(),
    territoryCreated: z.boolean().meta({ description: 'Target territory is new in this run' }),
    previousTerritoryId: Id.nullable().meta({
      description: 'Existing local_territory_id when it differs from the target',
    }),
    candidateIds: z.array(Id).meta({ description: 'ambiguous: every matching record' }),
  })
  .meta({ id: 'TerritoryLinkRowResult' });
export type TerritoryLinkRowResult = z.infer<typeof TerritoryLinkRowResult>;

export const TerritoryLinkCreated = z
  .object({
    id: Id.nullable().meta({ description: 'null in a dry run' }),
    hqId: Id,
    hqCode: z.string(),
    code: z.string(),
    name: z.string(),
    territoryKey: z.string(),
    rows: z.int().meta({ description: 'Rows linked to it in this run' }),
  })
  .meta({ id: 'TerritoryLinkCreated' });
export type TerritoryLinkCreated = z.infer<typeof TerritoryLinkCreated>;

export const TerritoryLinkImportResult = z
  .object({
    dryRun: z.boolean(),
    fileName: z.string().nullable(),
    fileKey: z.string().nullable(),
    onLinked: z.enum(['keep', 'replace']),
    totals: z.object({
      rows: z.int(),
      linked: z.int(),
      alreadyLinked: z.int(),
      skipped: z.int(),
      unmatched: z.int(),
      error: z.int(),
      territoriesCreated: z.int(),
      doctorsLinked: z.int(),
      chemistsLinked: z.int(),
      unknownHq: z.int().meta({ description: 'unmatched: unknown_hq + not_headquarter' }),
      noMatch: z.int(),
      ambiguous: z.int(),
    }),
    territoriesCreated: z.array(TerritoryLinkCreated),
    nearDuplicates: z.array(z.object({ hqCode: z.string(), a: z.string(), b: z.string() })).meta({
      description:
        'Territory keys under one HQ that look alike (same consonants, or same first 4 letters). Listed for review, never merged',
    }),
    results: z.array(TerritoryLinkRowResult),
  })
  .meta({ id: 'TerritoryLinkImportResult' });
export type TerritoryLinkImportResult = z.infer<typeof TerritoryLinkImportResult>;
