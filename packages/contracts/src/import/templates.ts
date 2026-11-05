/**
 * The ONE import row format (docs/IMPORT.md): snake_case template columns with master CODES
 * (territory_code, specialty_code, division_code, ...). Shared by the mock and the real API.
 * Aliases accepted for convenience: camelCase keys (e.g. `territoryCode`, `registrationNo`),
 * header spacing/case (`Territory Code`), and the create-schema id fields (`territory_id`,
 * `specialty_id`, `division_id`, ... as UUIDs) or `location: {lat, lng}`.
 */
import * as z from 'zod';
import { ChemistCreate, DoctorCreate, StockistCreate } from '../schemas/masters';
import { ProductCreate, ProductHqMappingCreate } from '../schemas/products';
import { TerritoryLevel } from '../schemas/territories';
import type { ImportEntity } from '../schemas/imports';

export interface ImportCellError {
  column: string | null;
  code: string;
  message: string;
}
/** Code -> id resolvers (case-insensitive codes). Return undefined when unknown or out of scope. */
export interface ImportLookup {
  territory(code: string): string | undefined;
  specialty(code: string): string | undefined;
  category(code: string): string | undefined;
  division(code: string): string | undefined;
  product(code: string): string | undefined;
}

export const DivisionCreate = z
  .object({
    code: z.string().min(1).max(32),
    name: z.string().min(1).max(120),
    active: z.boolean(),
  })
  .meta({ id: 'DivisionCreate' });
export type DivisionCreate = z.infer<typeof DivisionCreate>;
export const TerritoryImportBody = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  level: TerritoryLevel,
  parentCode: z.string().max(32).nullable(),
  centroid: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable(),
});
export type TerritoryImportBody = z.infer<typeof TerritoryImportBody>;

export const IMPORT_TEMPLATES: Record<
  Exclude<ImportEntity, 'users'>,
  { required: string[]; optional: string[] }
> = {
  territories: {
    required: ['code', 'name', 'level'],
    optional: ['parent_code', 'centroid_lat', 'centroid_lng'],
  },
  divisions: { required: ['code', 'name'], optional: ['active'] },
  products: {
    required: ['code', 'name', 'division_code'],
    optional: [
      'brand',
      'composition',
      'pack_size',
      'form',
      'mrp',
      'ptr',
      'pts',
      'is_sample',
      'active',
    ],
  },
  product_hq: { required: ['hq_code', 'division_code'], optional: ['product_code'] },
  doctors: {
    required: ['name', 'territory_code'],
    optional: [
      'qualification',
      'specialty_code',
      'category_code',
      'registration_no',
      'date_of_birth',
      'anniversary',
      'email',
      'address_line',
      'city',
      'state',
      'pincode',
      'lat',
      'lng',
      'phone',
    ],
  },
  chemists: {
    required: ['name', 'territory_code'],
    optional: [
      'gstin',
      'drug_license_no',
      'address_line',
      'city',
      'state',
      'pincode',
      'lat',
      'lng',
      'phone',
    ],
  },
  stockists: {
    required: ['name', 'territory_code'],
    optional: [
      'gstin',
      'drug_license_no',
      'address_line',
      'city',
      'state',
      'pincode',
      'lat',
      'lng',
      'phone',
    ],
  },
};

const snake = (k: string) =>
  k
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s\-.]+/g, '_')
    .toLowerCase();

/** Normalise keys to snake_case and cells: trimmed strings, '' -> null. */
export function normaliseRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = snake(k);
    if (key === 'location' && v && typeof v === 'object') {
      const l = v as { lat?: unknown; lng?: unknown };
      out.lat ??= l.lat;
      out.lng ??= l.lng;
      continue;
    }
    if (key === 'centroid' && v && typeof v === 'object') {
      const l = v as { lat?: unknown; lng?: unknown };
      out.centroid_lat ??= l.lat;
      out.centroid_lng ??= l.lng;
      continue;
    }
    out[key] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : (v ?? null);
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const blank = (v: unknown) => {
  const s = str(v)?.trim();
  return s ? s : null;
};
function num(v: unknown, col: string, errs: ImportCellError[]) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  if (Number.isNaN(n)) {
    errs.push({ column: col, code: 'invalid_number', message: `${col} must be a number` });
    return null;
  }
  return n;
}
function bool(v: unknown, col: string, def: boolean, errs: ImportCellError[]) {
  if (v === null || v === undefined) return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(s)) return true;
  if (['n', 'no', 'false', '0'].includes(s)) return false;
  errs.push({ column: col, code: 'invalid_boolean', message: `${col} must be Y or N` });
  return def;
}
function ref(
  r: Record<string, unknown>,
  base: string,
  resolve: (c: string) => string | undefined,
  required: boolean,
  errs: ImportCellError[],
): string | null {
  const id = str(r[`${base}_id`]);
  if (id) {
    if (!UUID.test(id))
      errs.push({ column: `${base}_id`, code: 'invalid_id', message: `${base}_id must be a UUID` });
    return id;
  }
  const code = str(r[`${base}_code`]);
  if (!code) {
    if (required)
      errs.push({ column: `${base}_code`, code: 'required', message: `${base}_code is required` });
    return null;
  }
  const hit = resolve(code.toUpperCase());
  if (!hit)
    errs.push({
      column: `${base}_code`,
      code: 'unknown_code',
      message: `Unknown or out-of-scope ${base} code '${code}'`,
    });
  return hit ?? null;
}
function point(r: Record<string, unknown>, la: string, ln: string, errs: ImportCellError[]) {
  const lat = num(r[la], la, errs);
  const lng = num(r[ln], ln, errs);
  if (lat === null && lng === null) return null;
  if (lat === null || lng === null) {
    errs.push({
      column: lat === null ? la : ln,
      code: 'required',
      message: `${la} and ${ln} go together`,
    });
    return null;
  }
  return { lat, lng };
}

/** Map one template row to the entity's create body (camelCase, ids), then validate it. */
export function mapImportRow(
  entity: Exclude<ImportEntity, 'users'>,
  raw: Record<string, unknown>,
  lk: ImportLookup,
): { body: Record<string, unknown> | null; errors: ImportCellError[] } {
  const r = normaliseRow(raw);
  const errs: ImportCellError[] = [];
  let body: Record<string, unknown>;
  let schema: z.ZodType;
  const address = () => ({
    addressLine: str(r.address_line),
    city: str(r.city),
    state: str(r.state),
    pincode: str(r.pincode),
    location: point(r, 'lat', 'lng', errs),
    phone: str(r.phone),
  });
  switch (entity) {
    case 'doctors':
      schema = DoctorCreate;
      body = {
        name: str(r.name),
        territoryId: ref(r, 'territory', lk.territory, true, errs),
        qualification: str(r.qualification),
        specialtyId: ref(r, 'specialty', lk.specialty, false, errs),
        categoryId: ref(r, 'category', lk.category, false, errs),
        registrationNo: str(r.registration_no),
        dateOfBirth: blank(r.date_of_birth),
        anniversary: blank(r.anniversary),
        email: blank(r.email),
        ...address(),
      };
      break;
    case 'chemists':
    case 'stockists':
      schema = entity === 'chemists' ? ChemistCreate : StockistCreate;
      body = {
        name: str(r.name),
        territoryId: ref(r, 'territory', lk.territory, true, errs),
        gstin: str(r.gstin)?.toUpperCase() ?? null,
        drugLicenseNo: str(r.drug_license_no),
        ...address(),
      };
      break;
    case 'products':
      schema = ProductCreate;
      body = {
        code: str(r.code)?.toUpperCase() ?? null,
        name: str(r.name),
        divisionId: ref(r, 'division', lk.division, true, errs),
        brand: str(r.brand),
        composition: str(r.composition),
        packSize: str(r.pack_size),
        form: str(r.form)?.toLowerCase() ?? null,
        mrp: num(r.mrp, 'mrp', errs),
        ptr: num(r.ptr, 'ptr', errs),
        pts: num(r.pts, 'pts', errs),
        isSample: bool(r.is_sample, 'is_sample', false, errs),
        active: bool(r.active, 'active', true, errs),
      };
      break;
    case 'divisions':
      schema = DivisionCreate;
      body = {
        code: str(r.code)?.toUpperCase() ?? null,
        name: str(r.name),
        active: bool(r.active, 'active', true, errs),
      };
      break;
    case 'product_hq':
      schema = ProductHqMappingCreate;
      body = {
        territoryId: ref(
          { territory_code: r.hq_code, territory_id: r.territory_id },
          'territory',
          lk.territory,
          true,
          errs,
        ),
        divisionId: ref(r, 'division', lk.division, true, errs),
        productId: ref(r, 'product', lk.product, false, errs),
      };
      break;
    case 'territories':
      schema = TerritoryImportBody;
      body = {
        code: str(r.code)?.toUpperCase() ?? null,
        name: str(r.name),
        level: str(r.level)?.toLowerCase() ?? null,
        parentCode: str(r.parent_code)?.toUpperCase() ?? null,
        centroid: point(r, 'centroid_lat', 'centroid_lng', errs),
      };
      break;
  }
  const v = schema.safeParse(body);
  if (!v.success)
    for (const i of v.error.issues) {
      const col = i.path.length ? snakeCol(String(i.path[0])) : null;
      if (!errs.some((e) => e.column === col))
        errs.push({ column: col, code: i.code, message: i.message });
    }
  return { body: errs.length ? null : (v.data as Record<string, unknown>), errors: errs };
}
const COL: Record<string, string> = {
  territoryId: 'territory_code',
  specialtyId: 'specialty_code',
  categoryId: 'category_code',
  divisionId: 'division_code',
  productId: 'product_code',
  location: 'lat',
  centroid: 'centroid_lat',
  parentCode: 'parent_code',
};
const snakeCol = (k: string) => COL[k] ?? snake(k);

export type DupRuleName = 'registration_no' | 'name_pincode' | 'gstin' | 'drug_license_no' | 'code';
/** Duplicate keys per entity, in rule order (#26). `body` is the mapped create body. */
export function duplicateKeys(
  entity: Exclude<ImportEntity, 'users'>,
  b: Record<string, unknown>,
): { rule: DupRuleName; key: string }[] {
  const out: { rule: DupRuleName; key: string }[] = [];
  const up = (v: unknown) => (v ? String(v).toUpperCase() : null);
  const namePin = (strip: boolean) =>
    b.name && b.pincode
      ? `${String(b.name)
          .toLowerCase()
          .replace(strip ? /^dr\.?\s*/ : /^$/, '')
          .trim()}|${b.pincode}`
      : null;
  const push = (rule: DupRuleName, key: string | null) => key && out.push({ rule, key });
  if (entity === 'doctors') {
    push('registration_no', up(b.registrationNo));
    push('name_pincode', namePin(true));
  } else if (entity === 'chemists' || entity === 'stockists') {
    push('gstin', up(b.gstin));
    push('drug_license_no', up(b.drugLicenseNo));
    push('name_pincode', namePin(false));
  } else if (entity === 'product_hq') {
    push('code', `${b.territoryId}|${b.divisionId}|${b.productId ?? ''}`);
  } else push('code', up(b.code));
  return out;
}
