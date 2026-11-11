import * as z from 'zod';
import { Id, Timestamp } from './common';
import { RoleKey } from './roles';
import { TerritoryLevel } from './territories';

/** SFC (Standard Fare Chart): per-employee routes from their HQ. See docs/SFC.md. */
export const SFC_TRAVEL_MODES = ['bike', 'bus', 'train', 'bus_train', 'car', 'other'] as const;
export const SfcTravelMode = z.enum(SFC_TRAVEL_MODES).meta({ id: 'SfcTravelMode' });
/** Default company TA rate per km (INR) for SFC amounts. */
export const SFC_DEFAULT_RATE_PER_KM = 2.95;

const Km = z.number().min(0).max(2500).multipleOf(0.01);
const Money = z.number().min(0).max(1_000_000).multipleOf(0.01);

export const SfcSettings = z
  .object({
    ratePerKm: Money.meta({ description: 'TA per km (INR) used to compute SFC amounts on write' }),
    version: z.int().meta({ description: 'Company row version (optimistic lock)' }),
  })
  .meta({ id: 'SfcSettings' });
export type SfcSettings = z.infer<typeof SfcSettings>;

export const SfcHq = z
  .object({
    id: Id,
    name: z.string(),
    code: z.string().nullable(),
    level: TerritoryLevel,
    parentId: Id.nullable(),
    parentName: z.string().nullable(),
    employeeCount: z.int().meta({ description: 'Visible sales-hierarchy employees on this HQ' }),
    routeCount: z.int().meta({ description: 'Live SFC routes with this HQ' }),
  })
  .meta({ id: 'SfcHq' });
export type SfcHq = z.infer<typeof SfcHq>;
export const SfcHqList = z.object({ items: z.array(SfcHq) }).meta({ id: 'SfcHqList' });

export const SfcEmployeeQuery = z
  .object({
    territoryId: Id.optional().meta({
      description: 'HQ (or any territory): employees assigned to it or anywhere below it',
    }),
  })
  .meta({ id: 'SfcEmployeeQuery' });
export const SfcEmployee = z
  .object({
    id: Id,
    name: z.string(),
    employeeCode: z.string().nullable(),
    role: RoleKey.nullable(),
    rank: z.int(),
    hqTerritoryIds: z.array(Id),
    routeCount: z.int(),
    hasSfc: z.boolean(),
    canEdit: z.boolean().meta({ description: 'Caller may PUT this table' }),
  })
  .meta({ id: 'SfcEmployee' });
export type SfcEmployee = z.infer<typeof SfcEmployee>;
export const SfcEmployeeList = z
  .object({ items: z.array(SfcEmployee) })
  .meta({ id: 'SfcEmployeeList' });

/** SFC route category = DCR band source (2026-10-28): ex -> ex_hq, hq -> hq, os -> outstation. */
export const SfcCategory = z.enum(['ex', 'hq', 'os']).meta({ id: 'SfcCategory' });
export type SfcCategory = z.infer<typeof SfcCategory>;
export const SFC_CATEGORY_BAND = { ex: 'ex_hq', hq: 'hq', os: 'outstation' } as const;

/**
 * What a save may store. The three bands, plus the two labels the 2026-10-28 data fix
 * deliberately left as text (Meeting never matches a DCR band; EX / OS is not one band).
 */
export const SfcStoredCategory = z.enum(['ex', 'hq', 'os', 'EX / OS', 'MEETING']);
export type SfcStoredCategory = z.infer<typeof SfcStoredCategory>;

/**
 * Dropdown and sheet labels the page sends, in any case or spacing.
 * HQ is hq. EX and EX HQ are ex. OS and OUT EX HQ are os.
 * EX / OS and MEETING are kept as those labels. Blank is null. Anything else is undefined.
 */
export function sfcCategoryFromLabel(v: unknown): SfcStoredCategory | null | undefined {
  if (v == null) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const k = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (k === 'HQ') return 'hq';
  if (k === 'EX' || k === 'EXHQ') return 'ex';
  if (k === 'OS' || k === 'OUTSTATION' || k === 'OUTEXHQ') return 'os';
  if (k === 'EXOS') return 'EX / OS';
  if (k === 'MEETING') return 'MEETING';
  return undefined;
}

/** Preferred dropdown label for a stored category. */
export function sfcCategoryLabel(stored: string | null | undefined): string {
  if (stored === 'hq') return 'HQ';
  if (stored === 'ex') return 'EX';
  if (stored === 'os') return 'OS';
  if (stored === 'EX / OS' || stored === 'MEETING') return stored;
  return stored ?? '';
}

export const SfcRoute = z
  .object({
    id: Id,
    sortOrder: z.int(),
    fromPlace: z.string(),
    toPlace: z.string(),
    oneWayKm: z.number(),
    bothWayKm: z.number(),
    oneWayAmount: z.number().nullable().meta({ description: 'null = actual fare' }),
    bothWayAmount: z.number().nullable().meta({ description: 'null = actual fare' }),
    actualFare: z.boolean(),
    travelMode: SfcTravelMode.nullable(),
    category: z.string().nullable().meta({
      description:
        "'ex' | 'hq' | 'os' (SfcCategory). Rows not yet migrated by the data fix may still hold legacy text; show it and require a choice on edit.",
    }),
    da: z.number().nullable(),
    version: z.int(),
    updatedAt: Timestamp,
  })
  .meta({ id: 'SfcRoute' });
export type SfcRoute = z.infer<typeof SfcRoute>;

export const SfcTable = z
  .object({
    userId: Id,
    userName: z.string(),
    hqTerritoryId: Id.nullable().meta({
      description: 'HQ of the stored routes, else the user’s HQ',
    }),
    ratePerKm: z.number(),
    etag: z.string().meta({
      description:
        'Table version: send it back on PUT; any change by anyone changes it (409 VERSION_CONFLICT)',
    }),
    canEdit: z.boolean(),
    routes: z.array(SfcRoute),
  })
  .meta({ id: 'SfcTable' });
export type SfcTable = z.infer<typeof SfcTable>;

export const SfcRouteInput = z
  .object({
    id: Id.optional().meta({ description: 'Existing route id (kept); omit for a new row' }),
    fromPlace: z.string().trim().min(1).max(120),
    toPlace: z.string().trim().min(1).max(120),
    oneWayKm: Km,
    actualFare: z.boolean().default(false),
    travelMode: SfcTravelMode.nullable().default(null),
    category: z
      .preprocess(
        (v) => (v === undefined ? undefined : sfcCategoryFromLabel(v)),
        SfcStoredCategory.nullable(),
      )
      .default(null)
      .meta({
        description:
          'HQ/EX/EX HQ/OS/OUT EX HQ (any case) are stored as hq, ex, or os. EX / OS and MEETING are stored as those labels. Anything else is 422 VALIDATION.',
      }),
    da: Money.nullable().default(null),
  })
  .meta({ id: 'SfcRouteInput' });
export type SfcRouteInput = z.infer<typeof SfcRouteInput>;

export const SfcTablePut = z
  .object({
    etag: z
      .string()
      .meta({ description: 'From the last GET ("" for a table that never had rows)' }),
    hqTerritoryId: Id.meta({ description: 'One of the employee’s assigned territories' }),
    routes: z
      .array(SfcRouteInput)
      .max(200)
      .meta({ description: 'Full table in display order; rows left out are deleted (soft)' }),
  })
  .meta({ id: 'SfcTablePut' });
export type SfcTablePut = z.infer<typeof SfcTablePut>;

/** Server-side amount rule (shared with the importer, tests and mocks). */
export function sfcAmounts(oneWayKm: number, actualFare: boolean, ratePerKm: number) {
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const bothWayKm = r2(oneWayKm * 2);
  if (actualFare) return { bothWayKm, oneWayAmount: null, bothWayAmount: null };
  const oneWayAmount = r2(oneWayKm * ratePerKm);
  return { bothWayKm, oneWayAmount, bothWayAmount: r2(oneWayAmount * 2) };
}
