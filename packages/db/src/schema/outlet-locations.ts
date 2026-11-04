import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  geometry,
  index,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { outletKind } from './activity';
import { companyId, pk, syncCols } from './_common';
import { geoSource } from './devices';
import { companies, users } from './tenancy';

/**
 * Locked practice / shop coordinates. Doctors may have many active rows; chemists and stockists
 * at most one (partial unique index). Reps add on first lock; ABM→Director (and system_admin) edit.
 */
export const outletLocations = pgTable(
  'outlet_locations',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    outletKind: outletKind('outlet_kind').notNull(),
    outletId: uuid('outlet_id').notNull(),
    /** Fixed label set per outlet kind (enforced in contracts + CHECK). */
    label: text('label').notNull(),
    location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    accuracyM: real('accuracy_m'),
    source: geoSource('source').notNull().default('gps'),
    isMock: boolean('is_mock').notNull().default(false),
    lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
    lockedBy: uuid('locked_by')
      .notNull()
      .references(() => users.id),
    active: boolean('active').notNull().default(true),
    ...syncCols(),
  },
  (t) => [
    index('outlet_locations_outlet_idx').on(t.companyId, t.outletKind, t.outletId),
    index('outlet_locations_location_gix').using('gist', t.location),
    uniqueIndex('outlet_locations_chem_stock_active_uq')
      .on(t.companyId, t.outletKind, t.outletId)
      .where(
        sql`${t.active} and ${t.deletedAt} is null and ${t.outletKind} in ('chemist','stockist')`,
      ),
    check(
      'outlet_locations_label_ck',
      sql`(${t.outletKind} = 'doctor' and ${t.label} in ('clinic','hospital','chamber','residence','nursing_home','other'))
       or (${t.outletKind} = 'chemist' and ${t.label} in ('retail_shop','distributor_counter','other'))
       or (${t.outletKind} = 'stockist' and ${t.label} in ('godown','depot','office','other'))`,
    ),
  ],
);

export const geoLockAction = pgEnum('geo_lock_action', [
  'lock',
  'edit',
  'deactivate',
  'reactivate',
]);

/** Append-only trail of outlet location locks and manager edits. */
export const geoLockEvents = pgTable(
  'geo_lock_events',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    outletKind: outletKind('outlet_kind').notNull(),
    outletId: uuid('outlet_id').notNull(),
    locationId: uuid('location_id').references(() => outletLocations.id),
    action: geoLockAction('action').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    before: text('before'), // JSON string (portable; jsonb also fine — keep text for stub DBs)
    after: text('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('geo_lock_events_outlet_idx').on(t.companyId, t.outletKind, t.outletId, t.at),
    index('geo_lock_events_location_idx').on(t.companyId, t.locationId, t.at),
  ],
);
