import * as z from 'zod';
import { Id, Timestamp } from './common';

/** Product prices admin (system_admin only, permission `products:prices`). Docs: docs/PRODUCTS.md. */
export const PRICE_MAX = 1_000_000;
const twoDp = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
export const Price = z
  .number()
  .min(0)
  .max(PRICE_MAX)
  .refine(twoDp, { message: 'At most 2 decimal places' })
  .meta({ description: `INR, 0..${PRICE_MAX}, at most 2 decimals`, example: 12.35 });

const ptrLeMrp = (p: { ptr?: number | null; mrp?: number | null }) =>
  p.ptr == null || p.mrp == null || p.ptr <= p.mrp;
const priceFields = {
  mrp: Price.nullable().optional().meta({ description: 'MRP; null clears it' }),
  ptr: Price.nullable().optional().meta({ description: 'Price to retailer; drives POB value' }),
  pts: Price.nullable().optional().meta({ description: 'Price to stockist; null clears it' }),
};

export const AdminProductQuery = z
  .object({
    q: z.string().trim().max(120).optional().meta({ description: 'Search code or name' }),
    missingPtr: z.enum(['true', 'false']).optional(),
    active: z.enum(['true', 'false']).optional(),
    brand: z
      .string()
      .trim()
      .max(120)
      .optional()
      .meta({ description: 'Exact brand (case-insensitive)' }),
    divisionId: Id.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
    cursor: z.string().max(200).optional().meta({ description: 'Opaque cursor from `nextCursor`' }),
  })
  .meta({ id: 'AdminProductQuery' });
export type AdminProductQuery = z.output<typeof AdminProductQuery>;

export const AdminProduct = z
  .object({
    id: Id,
    code: z.string(),
    name: z.string(),
    brand: z.string().nullable(),
    divisionId: Id,
    active: z.boolean(),
    mrp: z.number().nullable(),
    ptr: z.number().nullable(),
    pts: z.number().nullable(),
    updatedAt: Timestamp,
    updatedBy: z
      .object({ id: Id, name: z.string() })
      .nullable()
      .meta({ description: 'Who last changed a price (from price history); null if never' }),
    pricesUpdatedAt: Timestamp.nullable(),
    version: z.int().min(1),
  })
  .meta({ id: 'AdminProduct' });
export type AdminProduct = z.infer<typeof AdminProduct>;
export const AdminProductList = z
  .object({ items: z.array(AdminProduct), nextCursor: z.string().nullable() })
  .meta({ id: 'AdminProductList' });

export const ProductPricesUpdate = z
  .object({
    ...priceFields,
    version: z
      .int()
      .min(1)
      .optional()
      .meta({ description: 'Send to get 409 VERSION_CONFLICT on a stale row' }),
  })
  .refine((b) => ['mrp', 'ptr', 'pts'].some((k) => k in b), {
    message: 'Send at least one of mrp, ptr, pts',
  })
  .meta({ id: 'ProductPricesUpdate' });
export type ProductPricesUpdate = z.infer<typeof ProductPricesUpdate>;

export const ProductPricesBulkRow = z
  .object({
    productId: Id.optional(),
    code: z.string().trim().min(1).max(40).optional(),
    ...priceFields,
  })
  .meta({ id: 'ProductPricesBulkRow' });
export type ProductPricesBulkRow = z.infer<typeof ProductPricesBulkRow>;
export const BULK_PRICE_MAX_ROWS = 300;
export const ProductPricesBulkRequest = z
  .object({
    rows: z
      .array(z.unknown())
      .min(1)
      .max(BULK_PRICE_MAX_ROWS)
      .meta({ description: 'ProductPricesBulkRow[]; each row is validated on its own' }),
  })
  .meta({ id: 'ProductPricesBulkRequest' });

export const BULK_PRICE_STATUSES = ['updated', 'unchanged', 'failed'] as const;
export const ProductPricesBulkResult = z
  .object({
    index: z.int().min(0),
    productId: Id.nullable(),
    productCode: z.string().nullable(),
    status: z.enum(BULK_PRICE_STATUSES),
    code: z
      .string()
      .nullable()
      .meta({ description: 'Error code when failed', example: 'PRODUCT_NOT_FOUND' }),
    message: z.string().nullable(),
  })
  .meta({ id: 'ProductPricesBulkResult' });
export type ProductPricesBulkResult = z.infer<typeof ProductPricesBulkResult>;
export const ProductPricesBulkResponse = z
  .object({
    bulkId: Id,
    summary: z.object({ total: z.int(), updated: z.int(), unchanged: z.int(), failed: z.int() }),
    results: z.array(ProductPricesBulkResult),
  })
  .meta({ id: 'ProductPricesBulkResponse' });
export type ProductPricesBulkResponse = z.infer<typeof ProductPricesBulkResponse>;

export const ProductPriceHistoryEntry = z
  .object({
    id: Id,
    productId: Id,
    old: z.object({
      mrp: z.number().nullable(),
      ptr: z.number().nullable(),
      pts: z.number().nullable(),
    }),
    new: z.object({
      mrp: z.number().nullable(),
      ptr: z.number().nullable(),
      pts: z.number().nullable(),
    }),
    source: z.enum(['single', 'bulk', 'masters']),
    bulkId: Id.nullable(),
    changedBy: z.object({ id: Id, name: z.string() }),
    changedAt: Timestamp,
  })
  .meta({ id: 'ProductPriceHistoryEntry' });
export const ProductPriceHistory = z
  .object({ items: z.array(ProductPriceHistoryEntry) })
  .meta({ id: 'ProductPriceHistory' });

/** Row-level checks shared by single and bulk (cross-field rules need the merged current row). */
export const pricesConsistent = (p: {
  ptr: number | null;
  mrp: number | null;
  pts: number | null;
}) => ptrLeMrp(p);
