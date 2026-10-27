import * as z from 'zod';
import { DateOnly, Id, Timestamp } from './common';
import { ExpenseClaim } from './expenses';
import { RoleKey } from './roles';

/** TA/DA auto-calculation (#39). See docs/TADA.md. */
export const ALLOWANCE_BANDS = ['hq', 'ex_hq', 'outstation'] as const;
export const AllowanceBand = z.enum(ALLOWANCE_BANDS).meta({
  id: 'AllowanceBand',
  description: 'From work_types.allowance_band (work types with band none get no TA/DA)',
});
export const PLACE_BANDS = ['ex_hq', 'outstation'] as const;
export const PlaceBand = z.enum(PLACE_BANDS).meta({ id: 'AllowancePlaceBand' });

const Money = z.number().min(0).max(1_000_000).multipleOf(0.01);

export const AllowanceRateInput = z
  .object({
    band: AllowanceBand,
    roleKey: RoleKey.nullable()
      .default(null)
      .meta({ description: 'null = all roles; a role-specific row wins over the all-roles row' }),
    effectiveFrom: DateOnly,
    daAmount: Money.meta({ description: 'Daily allowance per day in this band (INR)' }),
    taPerKm: Money.meta({ description: 'TA per km (ex-HQ / outstation), INR' }),
    taFixed: Money.meta({ description: 'Flat TA per day (e.g. HQ local conveyance), INR' }),
  })
  .meta({ id: 'AllowanceRateInput' });
export type AllowanceRateInput = z.infer<typeof AllowanceRateInput>;
export const AllowanceRateUpdate = AllowanceRateInput.extend({ version: z.int() }).meta({
  id: 'AllowanceRateUpdate',
});
export const AllowanceRate = z
  .object({
    id: Id,
    band: AllowanceBand,
    roleKey: RoleKey.nullable(),
    effectiveFrom: DateOnly,
    daAmount: z.number(),
    taPerKm: z.number(),
    taFixed: z.number(),
    updatedAt: Timestamp,
    version: z.int(),
  })
  .meta({ id: 'AllowanceRate' });
export type AllowanceRate = z.infer<typeof AllowanceRate>;
export const AllowanceRateList = z
  .object({ items: z.array(AllowanceRate) })
  .meta({ id: 'AllowanceRateList' });
export const AllowanceRateQuery = z
  .object({ band: AllowanceBand.optional(), roleKey: RoleKey.optional() })
  .meta({ id: 'AllowanceRateQuery' });

export const AllowancePlaceInput = z
  .object({
    hqTerritoryId: Id.meta({ description: 'A headquarter-level territory' }),
    name: z.string().trim().min(1).max(120).meta({ description: 'Town / place name' }),
    band: PlaceBand,
    oneWayKm: z.number().positive().max(2500).multipleOf(0.01),
    active: z.boolean().default(true),
  })
  .meta({ id: 'AllowancePlaceInput' });
export type AllowancePlaceInput = z.infer<typeof AllowancePlaceInput>;
export const AllowancePlaceUpdate = AllowancePlaceInput.extend({ version: z.int() }).meta({
  id: 'AllowancePlaceUpdate',
});
export const AllowancePlace = z
  .object({
    id: Id,
    hqTerritoryId: Id,
    hqName: z.string(),
    name: z.string(),
    band: PlaceBand,
    oneWayKm: z.number(),
    active: z.boolean(),
    updatedAt: Timestamp,
    version: z.int(),
  })
  .meta({ id: 'AllowancePlace' });
export type AllowancePlace = z.infer<typeof AllowancePlace>;
export const AllowancePlaceList = z
  .object({ items: z.array(AllowancePlace) })
  .meta({ id: 'AllowancePlaceList' });
export const AllowancePlaceQuery = z
  .object({
    hqTerritoryId: Id.optional(),
    band: PlaceBand.optional(),
    q: z.string().trim().max(60).optional(),
    includeInactive: z.enum(['true', 'false']).optional(),
  })
  .meta({ id: 'AllowancePlaceQuery' });

export const AllowanceDraftRequest = z
  .object({
    dryRun: z.boolean().default(false),
    places: z
      .record(DateOnly, Id)
      .default({})
      .meta({ description: 'Fare-chart place per ex-HQ/outstation date: {"2026-10-05": placeId}' }),
  })
  .meta({ id: 'AllowanceDraftRequest' });
export type AllowanceDraftRequest = z.infer<typeof AllowanceDraftRequest>;

export const ALLOWANCE_DAY_ISSUES = [
  'no_rate',
  'place_required',
  'manual_line_exists',
  'dcr_not_submitted',
] as const;
export const AllowanceDay = z
  .object({
    date: DateOnly,
    dcrId: Id,
    workTypeCode: z.string(),
    band: AllowanceBand.nullable().meta({ description: 'null = work type pays no TA/DA' }),
    rateId: Id.nullable(),
    placeId: Id.nullable(),
    placeName: z.string().nullable(),
    km: z.number().nullable().meta({ description: 'Round trip (2 x one-way)' }),
    da: z.number(),
    ta: z.number(),
    issues: z.array(z.enum(ALLOWANCE_DAY_ISSUES)),
  })
  .meta({ id: 'AllowanceDay' });
export type AllowanceDay = z.infer<typeof AllowanceDay>;
export const AllowanceDraftResult = z
  .object({
    dryRun: z.boolean(),
    days: z.array(AllowanceDay),
    totals: z.object({ da: z.number(), ta: z.number(), km: z.number(), lines: z.int() }),
    claim: ExpenseClaim.nullable().meta({ description: 'The updated claim; null on dryRun' }),
  })
  .meta({ id: 'AllowanceDraftResult' });
export type AllowanceDraftResult = z.infer<typeof AllowanceDraftResult>;
