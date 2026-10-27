import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { companies, territories, users } from './tenancy';

/** Travel modes accepted on an SFC route (null = not stated). */
export const SFC_TRAVEL_MODES = ['bike', 'bus', 'train', 'bus_train', 'car', 'other'] as const;

/**
 * Standard Fare Chart (SFC): one employee's agreed routes from their HQ. Amounts are computed by
 * the API on write from the company rate per km (companies.sfc_rate_per_km); null amounts mean
 * "actual fare" (paid on ticket). DA is free-form and stored as typed.
 */
export const sfcRoutes = pgTable(
  'sfc_routes',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    hqTerritoryId: uuid('hq_territory_id')
      .notNull()
      .references(() => territories.id),
    sortOrder: integer('sort_order').notNull().default(0),
    fromPlace: text('from_place').notNull(),
    toPlace: text('to_place').notNull(),
    oneWayKm: numeric('one_way_km', { precision: 8, scale: 2 }).notNull(),
    bothWayKm: numeric('both_way_km', { precision: 8, scale: 2 }).notNull(),
    oneWayAmount: numeric('one_way_amount', { precision: 12, scale: 2 }),
    bothWayAmount: numeric('both_way_amount', { precision: 12, scale: 2 }),
    actualFare: boolean('actual_fare').notNull().default(false),
    travelMode: text('travel_mode', { enum: SFC_TRAVEL_MODES }),
    category: text('category'),
    da: numeric('da', { precision: 12, scale: 2 }),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...syncCols(),
  },
  (t) => [
    index('sfc_routes_user_idx').on(t.companyId, t.userId),
    index('sfc_routes_hq_idx').on(t.companyId, t.hqTerritoryId),
    check(
      'sfc_routes_mode_ck',
      sql`${t.travelMode} is null or ${t.travelMode} in ('bike','bus','train','bus_train','car','other')`,
    ),
    check('sfc_routes_km_ck', sql`${t.oneWayKm} >= 0 and ${t.oneWayKm} <= 2500`),
    check(
      'sfc_routes_place_ck',
      sql`length(${t.fromPlace}) between 1 and 120 and length(${t.toPlace}) between 1 and 120`,
    ),
    check('sfc_routes_category_ck', sql`${t.category} is null or length(${t.category}) <= 40`),
    check('sfc_routes_da_ck', sql`${t.da} is null or ${t.da} >= 0`),
    check(
      'sfc_routes_fare_ck',
      sql`(${t.actualFare} and ${t.oneWayAmount} is null and ${t.bothWayAmount} is null) or (not ${t.actualFare} and ${t.oneWayAmount} is not null and ${t.bothWayAmount} is not null)`,
    ),
  ],
);
