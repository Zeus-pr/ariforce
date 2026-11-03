import * as z from 'zod';
import { Id, Month, Timestamp } from './common';

/** Sales targets and actuals (sales:write: director and system_admin). One HQ territory per row. */
export const SALES_KINDS = ['primary', 'secondary'] as const;
export const SalesKind = z.enum(SALES_KINDS).meta({ id: 'SalesKind' });

const Amount = z.number().min(0).max(100_000_000_000).multipleOf(0.01);

export const SalesTarget = z
  .object({
    id: Id,
    territoryId: Id,
    territoryName: z.string(),
    territoryCode: z.string(),
    month: Month,
    kind: SalesKind,
    value: z.number().meta({ description: 'Target value, rupees' }),
    quantity: z.number().int().nullable(),
    updatedAt: Timestamp,
  })
  .meta({ id: 'SalesTarget' });
export type SalesTarget = z.infer<typeof SalesTarget>;

export const SalesTargetQuery = z
  .object({
    from: Month,
    to: Month,
    territoryId: Id.optional(),
    kind: SalesKind.optional(),
  })
  .refine((q) => q.from <= q.to, { message: 'from must not be after to', path: ['to'] })
  .meta({ id: 'SalesTargetQuery' });

export const SalesTargetList = z
  .object({ data: z.array(SalesTarget) })
  .meta({ id: 'SalesTargetList' });

export const SalesTargetSet = z
  .object({
    territoryId: Id.meta({ description: 'An HQ (headquarter level) territory' }),
    kind: SalesKind,
    fromMonth: Month,
    toMonth: Month,
    value: Amount.meta({
      description:
        'Rupees. Per month when spread = each, the total for the whole period when spread = total',
    }),
    spread: z.enum(['each', 'total']).default('each'),
    quantity: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
    overwrite: z
      .boolean()
      .default(false)
      .meta({ description: 'false: 409 TARGETS_EXIST when a month already has a target' }),
  })
  .refine((b) => b.fromMonth <= b.toMonth, {
    message: 'fromMonth must not be after toMonth',
    path: ['toMonth'],
  })
  .meta({ id: 'SalesTargetSet' });
export type SalesTargetSet = z.infer<typeof SalesTargetSet>;

export const SalesTargetSetResult = z
  .object({ months: z.number().int(), created: z.number().int(), updated: z.number().int() })
  .meta({ id: 'SalesTargetSetResult' });

export const SalesActual = z
  .object({
    id: Id,
    territoryId: Id,
    territoryName: z.string(),
    territoryCode: z.string(),
    productId: Id,
    productName: z.string(),
    stockistId: Id.nullable(),
    month: Month,
    kind: SalesKind,
    quantity: z.number().int(),
    freeQuantity: z.number().int(),
    value: z.number(),
    isReturn: z.boolean(),
    updatedAt: Timestamp,
  })
  .meta({ id: 'SalesActual' });
export type SalesActual = z.infer<typeof SalesActual>;

export const SalesActualQuery = z
  .object({ month: Month, territoryId: Id.optional(), kind: SalesKind.optional() })
  .meta({ id: 'SalesActualQuery' });
export const SalesActualList = z
  .object({ data: z.array(SalesActual) })
  .meta({ id: 'SalesActualList' });

export const SalesActualCreate = z
  .object({
    territoryId: Id.meta({ description: 'An HQ (headquarter level) territory' }),
    productId: Id,
    stockistId: Id.nullable().default(null),
    month: Month,
    kind: SalesKind,
    quantity: z.number().int().min(0).max(1_000_000_000).default(0),
    freeQuantity: z.number().int().min(0).max(1_000_000_000).default(0),
    value: Amount,
    isReturn: z.boolean().default(false),
  })
  .meta({ id: 'SalesActualCreate' });
export type SalesActualCreate = z.infer<typeof SalesActualCreate>;

export const SALES_IMPORT_MAX_ROWS = 2000;
export const SalesImportRow = z
  .object({
    territoryCode: z.string().min(1),
    productCode: z.string().nullable().default(null),
    month: Month,
    kind: SalesKind,
    value: z.number().min(0),
    quantity: z.number().int().min(0).nullable().default(null),
    freeQuantity: z.number().int().min(0).default(0),
    isReturn: z.boolean().default(false),
  })
  .meta({ id: 'SalesImportRow' });
export type SalesImportRow = z.infer<typeof SalesImportRow>;

export const SalesImportRequest = z
  .object({
    entity: z.enum(['targets', 'actuals']),
    dryRun: z.boolean().default(true),
    rows: z.array(SalesImportRow).min(1).max(SALES_IMPORT_MAX_ROWS),
  })
  .meta({ id: 'SalesImportRequest' });
export type SalesImportRequest = z.infer<typeof SalesImportRequest>;

export const SALES_IMPORT_ERRORS = [
  'unknown_territory',
  'not_headquarter',
  'unknown_product',
  'product_required',
] as const;
export const SalesImportRowResult = z
  .object({
    row: z.number().int().meta({ description: '1-based position in the request' }),
    status: z.enum(['valid', 'created', 'updated', 'error']),
    error: z.enum(SALES_IMPORT_ERRORS).nullable(),
  })
  .meta({ id: 'SalesImportRowResult' });
export const SalesImportResult = z
  .object({
    dryRun: z.boolean(),
    totals: z.object({
      rows: z.number().int(),
      valid: z.number().int(),
      created: z.number().int(),
      updated: z.number().int(),
      errors: z.number().int(),
    }),
    results: z.array(SalesImportRowResult),
  })
  .meta({ id: 'SalesImportResult' });
export type SalesImportResult = z.infer<typeof SalesImportResult>;

/** First day of the month for a YYYY-MM value, and every month in [from, to]. */
export const monthStartOf = (m: string) => `${m}-01`;
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
