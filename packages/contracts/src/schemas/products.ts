import * as z from 'zod';
import { Id, Syncable, listQuery } from './common';

const writable = {
  id: true,
  companyId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  version: true,
} as const;

export const Division = Syncable.extend({
  code: z.string().max(32),
  name: z.string().max(120),
  active: z.boolean(),
}).meta({ id: 'Division' });
export type Division = z.infer<typeof Division>;

/**
 * Product picture (set via PUT /v1/products/{id}/image, never via create/update). imageUrl is a
 * presigned R2 GET, valid at least 30 min (same URL within a 30-min window, so browsers can cache it).
 */
export const productImageFields = {
  imageFileKey: z.string().max(300).nullable().default(null).meta({
    description: 'R2 key of the product picture (upload purpose product_image); null = none',
  }),
  imageUrl: z.url().nullable().default(null).meta({
    description:
      'Presigned GET for the picture (valid >= 30 min, <= 60 min); null if none or storage is off. Re-fetch the product for a fresh URL.',
  }),
};

/** A strength token: 50, 7.5, 10/0.25, 650mg (a number, optionally with a unit attached). */
const STRENGTH_TOKEN = /^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*(?:mg|mcg|g|ml|iu|%)?$/i;
/** A unit written as its own word after a strength ('10 mg'). */
const UNIT_TOKEN = /^(?:mg|mcg|g|ml|iu|%)$/i;
/**
 * Product name without strength numbers, for doctor detailing ('ARIPIX 10' -> 'ARIPIX',
 * 'ESCINEX CZ 10/0.25' -> 'ESCINEX CZ', 'NERGALIN 75 SR' -> 'NERGALIN SR', 'Paracetamol 650 mg'
 * -> 'Paracetamol'). The first word is always kept; letter variants (OD, ER, MD, CZ, D, M, F,
 * FORTE, PLUS, CD3...) are separate products and are kept. Whitespace is collapsed; case is kept.
 */
export function productDisplayName(name: string): string {
  const [first = '', ...rest] = name.trim().split(/\s+/);
  const out = [first];
  let afterStrength = false;
  for (const w of rest) {
    if (STRENGTH_TOKEN.test(w) || (afterStrength && UNIT_TOKEN.test(w))) afterStrength = true;
    else {
      out.push(w);
      afterStrength = false;
    }
  }
  return out.join(' ');
}

export const Product = Syncable.extend({
  divisionId: Id,
  code: z.string().max(40).meta({ description: 'Company SKU code, unique per company' }),
  name: z.string().min(1).max(160),
  displayName: z.string().min(1).max(160).meta({
    readOnly: true,
    description:
      "Name without strength numbers, derived from name (e.g. 'ARIPIX 10' -> 'ARIPIX'); several SKUs can share one. Use for doctor detailing pickers.",
    example: 'ARIPIX',
  }),
  brand: z.string().max(120).nullable(),
  composition: z.string().max(300).nullable(),
  packSize: z.string().max(60).nullable().meta({ example: '10 x 10 tablets' }),
  form: z.enum(['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'other']).nullable(),
  mrp: z.number().min(0).nullable().meta({ description: 'MRP in INR' }),
  ptr: z.number().min(0).nullable().meta({ description: 'Price to retailer, INR' }),
  pts: z.number().min(0).nullable().meta({ description: 'Price to stockist, INR' }),
  isSample: z.boolean().meta({ description: 'Can be given as a physician sample' }),
  active: z.boolean(),
  ...productImageFields,
}).meta({ id: 'Product' });
export type Product = z.infer<typeof Product>;
export const ProductCreate = Product.omit({
  ...writable,
  displayName: true,
  imageFileKey: true,
  imageUrl: true,
}).meta({
  id: 'ProductCreate',
});
export const ProductUpdate = ProductCreate.partial()
  .extend({ version: z.int().min(1) })
  .meta({ id: 'ProductUpdate' });
export type ProductCreate = z.infer<typeof ProductCreate>;
export type ProductUpdate = z.infer<typeof ProductUpdate>;
export const ProductListQuery = listQuery(['code', 'name', 'updatedAt'] as const, {
  divisionId: Id.optional(),
  territoryId: Id.optional().meta({ description: 'Only products mapped to this HQ territory' }),
  active: z.enum(['true', 'false']).optional(),
});

/** Which divisions/products are promoted in which HQ (territory of level headquarter). */
export const ProductHqMapping = Syncable.extend({
  territoryId: Id,
  divisionId: Id,
  productId: Id.nullable().meta({ description: 'Null = whole division' }),
}).meta({ id: 'ProductHqMapping' });
export type ProductHqMapping = z.infer<typeof ProductHqMapping>;
export const ProductHqMappingCreate = ProductHqMapping.omit(writable).meta({
  id: 'ProductHqMappingCreate',
});

export const WorkType = Syncable.extend({
  code: z.string().max(32).meta({ example: 'FIELD' }),
  name: z.string().max(120),
  kind: z.enum(['field', 'non_field', 'leave', 'holiday']),
  requiresCalls: z.boolean().meta({ description: 'DCR must have at least one call' }),
  active: z.boolean(),
}).meta({ id: 'WorkType' });
export type WorkType = z.infer<typeof WorkType>;
export const WorkTypeCreate = WorkType.omit(writable).meta({ id: 'WorkTypeCreate' });
export const WorkTypeUpdate = WorkTypeCreate.partial()
  .extend({ version: z.int().min(1) })
  .meta({ id: 'WorkTypeUpdate' });
