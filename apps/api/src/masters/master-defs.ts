import * as z from 'zod';
import {
  Chemist,
  ChemistCreate,
  ChemistUpdate,
  CodeNameListQuery,
  Division,
  Doctor,
  DoctorCategory,
  DoctorCreate,
  DoctorListQuery,
  DoctorUpdate,
  OutletListQuery,
  Product,
  ProductCreate,
  ProductHqMapping,
  ProductHqMappingCreate,
  ProductListQuery,
  ProductUpdate,
  Specialty,
  Stockist,
  StockistCreate,
  StockistUpdate,
  Territory,
  TerritoryListQuery,
  WorkType,
  WorkTypeCreate,
  WorkTypeUpdate,
  type Permission,
} from '@ariforce/contracts';
import {
  chemists,
  divisions,
  doctorCategories,
  doctors,
  productHqMappings,
  products,
  specialties,
  stockists,
  territories,
  workTypes,
} from '@ariforce/db';
import { eq, exists, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Principal } from '../auth/principal';

type Row = Record<string, unknown>;
type Q = Record<string, unknown>;
/** Table with the standard sync columns. */
type MasterTable = PgTable & {
  id: AnyPgColumn;
  companyId: AnyPgColumn;
  updatedAt: AnyPgColumn;
  createdAt: AnyPgColumn;
  deletedAt: AnyPgColumn;
  version: AnyPgColumn;
};

export interface MasterDef {
  /** audit/entity name, e.g. `doctor` */
  entity: string;
  table: MasterTable;
  dto: z.ZodType;
  listQuery: z.ZodType;
  create?: z.ZodType;
  update?: z.ZodType;
  /** Rows owned by a territory: hierarchy scope via that territory's path. Otherwise company-wide. */
  territoryCol?: AnyPgColumn;
  /** Writes need a company-wide principal (director/system admin) on top of the permission. */
  wideWrite: boolean;
  writePermission: Permission;
  sort: Record<string, AnyPgColumn>;
  search: AnyPgColumn[];
  filters?: (q: Q) => (SQL | undefined)[];
  /** DB row -> plain object (dto parse strips internal columns). */
  fromRow?: (r: Row) => Row;
  /** create/update body -> DB values. */
  toRow?: (b: Row, p: Principal) => Row;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);
const xy = (v: unknown) => {
  const p = v as { x: number; y: number } | null;
  return p ? { lat: p.y, lng: p.x } : null;
};
const toXy = (v: unknown) => {
  const p = v as { lat: number; lng: number } | null | undefined;
  return p === undefined ? undefined : p ? { x: p.lng, y: p.lat } : null;
};
export function baseFromRow(r: Row): Row {
  const o: Row = {};
  for (const [k, v] of Object.entries(r)) o[k] = iso(v);
  return o;
}
const withLocation = (r: Row) => ({ ...r, location: xy(r.location) });
const locationToRow = (b: Row) => {
  const out = { ...b };
  if ('location' in b) out.location = toXy(b.location);
  return out;
};
/** Subtree of `id` (or `id` itself) by territory path. */
export const inSubtree = (col: AnyPgColumn, id: string) =>
  exists(
    sql`(select 1 from ${territories} t0 join ${territories} t1 on t1.id = ${col}
      where t0.id = ${id} and (t1.path = t0.path or t1.path like t0.path || '.%'))`,
  );

const outlet = (
  table: typeof chemists | typeof stockists,
  entity: string,
  dto: z.ZodType,
  c: z.ZodType,
  u: z.ZodType,
): MasterDef => ({
  entity,
  table,
  dto,
  listQuery: OutletListQuery,
  create: c,
  update: u,
  territoryCol: table.territoryId,
  wideWrite: false,
  writePermission: 'masters:write',
  sort: {
    name: table.name,
    city: table.city,
    updatedAt: table.updatedAt,
    createdAt: table.createdAt,
  },
  search: [table.name, table.gstin, table.drugLicenseNo, table.city, table.pincode],
  filters: (q) => [q.territoryId ? inSubtree(table.territoryId, String(q.territoryId)) : undefined],
  fromRow: withLocation,
  toRow: locationToRow,
});

export const MASTERS: Record<string, MasterDef> = {
  doctors: {
    entity: 'doctor',
    table: doctors,
    dto: Doctor,
    listQuery: DoctorListQuery,
    create: DoctorCreate,
    update: DoctorUpdate,
    territoryCol: doctors.territoryId,
    wideWrite: false,
    writePermission: 'masters:write',
    sort: {
      name: doctors.name,
      city: doctors.city,
      updatedAt: doctors.updatedAt,
      createdAt: doctors.createdAt,
    },
    search: [doctors.name, doctors.registrationNo, doctors.city, doctors.pincode],
    filters: (q) => [
      q.territoryId ? inSubtree(doctors.territoryId, String(q.territoryId)) : undefined,
      q.specialtyId ? eq(doctors.specialtyId, String(q.specialtyId)) : undefined,
      q.categoryId ? eq(doctors.categoryId, String(q.categoryId)) : undefined,
    ],
    fromRow: withLocation,
    toRow: locationToRow,
  },
  chemists: outlet(chemists, 'chemist', Chemist, ChemistCreate, ChemistUpdate),
  stockists: outlet(stockists, 'stockist', Stockist, StockistCreate, StockistUpdate),
  products: {
    entity: 'product',
    table: products,
    dto: Product,
    listQuery: ProductListQuery,
    create: ProductCreate,
    update: ProductUpdate,
    wideWrite: true,
    writePermission: 'masters:write',
    sort: { code: products.code, name: products.name, updatedAt: products.updatedAt },
    search: [products.code, products.name, products.brand, products.composition],
    filters: (q) => [
      q.divisionId ? eq(products.divisionId, String(q.divisionId)) : undefined,
      q.active ? eq(products.active, q.active === 'true') : undefined,
      q.territoryId
        ? exists(
            sql`(select 1 from ${productHqMappings} m where m.territory_id = ${String(q.territoryId)}
              and m.deleted_at is null and m.division_id = ${products.divisionId}
              and (m.product_id is null or m.product_id = ${products.id}))`,
          )
        : undefined,
    ],
    fromRow: (r) => ({
      ...r,
      mrp: r.mrp == null ? null : Number(r.mrp),
      ptr: r.ptr == null ? null : Number(r.ptr),
      pts: r.pts == null ? null : Number(r.pts),
    }),
    toRow: (b) => {
      const o = { ...b };
      for (const k of ['mrp', 'ptr', 'pts']) if (k in o) o[k] = o[k] == null ? null : String(o[k]);
      if (typeof o.code === 'string') o.code = o.code.toUpperCase();
      return o;
    },
  },
  divisions: {
    entity: 'division',
    table: divisions,
    dto: Division,
    listQuery: CodeNameListQuery,
    wideWrite: true,
    writePermission: 'masters:write',
    sort: { code: divisions.code, name: divisions.name, updatedAt: divisions.updatedAt },
    search: [divisions.code, divisions.name],
  },
  'product-hq-mappings': {
    entity: 'product_hq_mapping',
    table: productHqMappings,
    dto: ProductHqMapping,
    listQuery: ProductListQuery,
    create: ProductHqMappingCreate,
    territoryCol: productHqMappings.territoryId,
    wideWrite: true,
    writePermission: 'masters:write',
    sort: {
      updatedAt: productHqMappings.updatedAt,
      code: productHqMappings.createdAt,
      name: productHqMappings.createdAt,
    },
    search: [],
    filters: (q) => [
      q.divisionId ? eq(productHqMappings.divisionId, String(q.divisionId)) : undefined,
      q.territoryId ? eq(productHqMappings.territoryId, String(q.territoryId)) : undefined,
    ],
  },
  territories: {
    entity: 'territory',
    table: territories,
    dto: Territory,
    listQuery: TerritoryListQuery,
    territoryCol: territories.id,
    wideWrite: true,
    writePermission: 'territories:write',
    sort: {
      code: territories.code,
      name: territories.name,
      level: territories.level,
      updatedAt: territories.updatedAt,
    },
    search: [territories.code, territories.name],
    filters: (q) => [
      q.level ? sql`${territories.level} = ${String(q.level)}` : undefined,
      q.parentId ? eq(territories.parentId, String(q.parentId)) : undefined,
      q.ancestorId ? inSubtree(territories.id, String(q.ancestorId)) : undefined,
      q.code ? sql`upper(${territories.code}) = ${String(q.code).toUpperCase()}` : undefined,
    ],
    fromRow: (r) => ({ ...r, centroid: xy(r.centroid) }),
  },
  specialties: {
    entity: 'specialty',
    table: specialties,
    dto: Specialty,
    listQuery: CodeNameListQuery,
    wideWrite: true,
    writePermission: 'masters:write',
    sort: { code: specialties.code, name: specialties.name, updatedAt: specialties.updatedAt },
    search: [specialties.code, specialties.name],
  },
  'doctor-categories': {
    entity: 'doctor_category',
    table: doctorCategories,
    dto: DoctorCategory,
    listQuery: CodeNameListQuery,
    wideWrite: true,
    writePermission: 'masters:write',
    sort: {
      code: doctorCategories.code,
      name: doctorCategories.name,
      updatedAt: doctorCategories.updatedAt,
    },
    search: [doctorCategories.code, doctorCategories.name],
    fromRow: (r) => ({ ...r, visitsPerMonth: r.visitsPerCycle }),
  },
  'work-types': {
    entity: 'work_type',
    table: workTypes,
    dto: WorkType,
    listQuery: CodeNameListQuery,
    create: WorkTypeCreate,
    update: WorkTypeUpdate,
    wideWrite: true,
    writePermission: 'masters:write',
    sort: { code: workTypes.code, name: workTypes.name, updatedAt: workTypes.updatedAt },
    search: [workTypes.code, workTypes.name],
    fromRow: (r) => ({ ...r, requiresCalls: r.countsAsFieldDay }),
    toRow: (b) => {
      const { requiresCalls, ...o } = b;
      return requiresCalls === undefined ? o : { ...o, countsAsFieldDay: requiresCalls };
    },
  },
};
