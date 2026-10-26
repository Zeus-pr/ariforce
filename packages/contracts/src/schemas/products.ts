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

export const Product = Syncable.extend({
  divisionId: Id,
  code: z.string().max(40).meta({ description: 'Company SKU code, unique per company' }),
  name: z.string().min(1).max(160),
  brand: z.string().max(120).nullable(),
  composition: z.string().max(300).nullable(),
  packSize: z.string().max(60).nullable().meta({ example: '10 x 10 tablets' }),
  form: z.enum(['tablet', 'capsule', 'syrup', 'injection', 'cream', 'drops', 'other']).nullable(),
  mrp: z.number().min(0).nullable().meta({ description: 'MRP in INR' }),
  ptr: z.number().min(0).nullable().meta({ description: 'Price to retailer, INR' }),
  pts: z.number().min(0).nullable().meta({ description: 'Price to stockist, INR' }),
  isSample: z.boolean().meta({ description: 'Can be given as a physician sample' }),
  active: z.boolean(),
}).meta({ id: 'Product' });
export type Product = z.infer<typeof Product>;
export const ProductCreate = Product.omit(writable).meta({ id: 'ProductCreate' });
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
