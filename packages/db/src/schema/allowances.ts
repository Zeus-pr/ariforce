import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { companies, roles, territories } from './tenancy';

/** Allowance bands that pay TA/DA (work_types.allowance_band minus 'none'). */
export const ALLOWANCE_BANDS = ['hq', 'ex_hq', 'outstation'] as const;

/**
 * TA/DA rate card (#39). One row per band (optionally per role) from `effective_from`.
 * Amounts are INR numeric(12,2); `ta_per_km` numeric(8,2).
 */
export const allowanceRates = pgTable(
  'allowance_rates',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    band: text('band', { enum: ALLOWANCE_BANDS }).notNull(),
    /** null = all roles. */
    roleId: uuid('role_id').references(() => roles.id),
    effectiveFrom: date('effective_from').notNull(),
    daAmount: numeric('da_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    taPerKm: numeric('ta_per_km', { precision: 8, scale: 2 }).notNull().default('0'),
    taFixed: numeric('ta_fixed', { precision: 12, scale: 2 }).notNull().default('0'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('allowance_rates_uq')
      .on(
        t.companyId,
        t.band,
        sql`coalesce(${t.roleId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.effectiveFrom,
      )
      .where(sql`${t.deletedAt} is null`),
    check('allowance_rates_band_ck', sql`${t.band} in ('hq','ex_hq','outstation')`),
    check(
      'allowance_rates_amounts_ck',
      sql`${t.daAmount} >= 0 and ${t.taPerKm} >= 0 and ${t.taFixed} >= 0`,
    ),
  ],
);

/** Standard fare chart (#39): places worked from an HQ with a fixed one-way distance. */
export const allowancePlaces = pgTable(
  'allowance_places',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    hqTerritoryId: uuid('hq_territory_id')
      .notNull()
      .references(() => territories.id),
    name: text('name').notNull(),
    band: text('band', { enum: ['ex_hq', 'outstation'] }).notNull(),
    oneWayKm: numeric('one_way_km', { precision: 8, scale: 2 }).notNull(),
    active: boolean('active').notNull().default(true),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('allowance_places_uq')
      .on(t.companyId, t.hqTerritoryId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('allowance_places_hq_idx').on(t.companyId, t.hqTerritoryId),
    check('allowance_places_band_ck', sql`${t.band} in ('ex_hq','outstation')`),
    check('allowance_places_km_ck', sql`${t.oneWayKm} > 0 and ${t.oneWayKm} <= 2500`),
    check('allowance_places_name_ck', sql`length(${t.name}) between 1 and 120`),
  ],
);
