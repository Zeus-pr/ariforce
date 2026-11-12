import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  geometry,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { companies, territories, users } from './tenancy';

export const specialties = pgTable(
  'specialties',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    ...syncCols(),
  },
  (t) => [uniqueIndex('specialties_company_code_uq').on(t.companyId, t.code)],
);

/** Doctor grade A/B/C with required visits per cycle (#25). Company-configurable. */
export const doctorCategories = pgTable(
  'doctor_categories',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    visitsPerCycle: integer('visits_per_cycle').notNull(),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('doctor_categories_company_code_uq').on(t.companyId, t.code),
    check('doctor_categories_visits_ck', sql`${t.visitsPerCycle} between 0 and 31`),
  ],
);

/** Configurable work types (#18): field / HQ / ex-HQ / outstation / meeting / transit / leave ... */
export const workTypeKind = pgEnum('work_type_kind', ['field', 'non_field', 'leave', 'holiday']);
export const workTypes = pgTable(
  'work_types',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: workTypeKind('kind').notNull(),
    /** Counts toward field-working days (call average denominator). */
    countsAsFieldDay: boolean('counts_as_field_day').notNull().default(false),
    /** Allowance band for TA/DA later (#39): hq | ex_hq | outstation | none. */
    allowanceBand: text('allowance_band', { enum: ['hq', 'ex_hq', 'outstation', 'none'] })
      .notNull()
      .default('none'),
    requiresLocation: boolean('requires_location').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...syncCols(),
  },
  (t) => [uniqueIndex('work_types_company_code_uq').on(t.companyId, t.code)],
);

export const approvalState = pgEnum('approval_state', [
  'draft',
  'pending',
  'approved',
  'rejected',
  'returned',
  'cancelled',
]);
export const verificationState = pgEnum('verification_state', [
  'unverified',
  'pending',
  'verified',
  'failed',
]);

const contact = () => ({
  addressLine: text('address_line'),
  city: text('city'),
  state: text('state'),
  pincode: text('pincode'),
  phone: text('phone'),
  location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }),
});

export const doctors = pgTable(
  'doctors',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    territoryId: uuid('territory_id')
      .notNull()
      .references(() => territories.id),
    /** Territory (level 'territory') under the HQ in territory_id (0042); null until backfilled. */
    localTerritoryId: uuid('local_territory_id').references(() => territories.id),
    name: text('name').notNull(),
    qualification: text('qualification'),
    specialtyId: uuid('specialty_id').references(() => specialties.id),
    categoryId: uuid('category_id').references(() => doctorCategories.id),
    /** Per-doctor override of the grade's visits per cycle (#25). */
    visitsPerCycleOverride: integer('visits_per_cycle_override'),
    registrationNo: text('registration_no'),
    registrationCouncil: text('registration_council'),
    verificationStatus: verificationState('verification_status').notNull().default('unverified'),
    /** Field-added doctors need approval (#26). */
    approvalStatus: approvalState('approval_status').notNull().default('approved'),
    /** Geofence radius in metres; null = company default (#24). */
    geofenceRadiusM: integer('geofence_radius_m'),
    /** Active GPS pins this doctor may have. Default 1. ABM and above set 1–5. */
    maxActiveLocks: integer('max_active_locks').notNull().default(1),
    geoTaggedAt: timestamp('geo_tagged_at', { withTimezone: true }),
    geoTaggedBy: uuid('geo_tagged_by').references(() => users.id),
    dateOfBirth: text('date_of_birth'),
    anniversary: text('anniversary'),
    email: text('email'),
    ...contact(),
    ...syncCols(),
  },
  (t) => [
    index('doctors_territory_idx').on(t.companyId, t.territoryId),
    index('doctors_local_territory_idx').on(t.companyId, t.localTerritoryId),
    index('doctors_updated_idx').on(t.companyId, t.updatedAt),
    // Duplicate detection on field-added doctors (#26).
    index('doctors_regno_idx').on(t.companyId, sql`upper(${t.registrationNo})`),
    index('doctors_pincode_idx').on(t.companyId, t.pincode),
    index('doctors_email_idx').on(t.companyId, sql`lower(${t.email})`),
    index('doctors_location_gix').using('gist', t.location),
    check(
      'doctors_geofence_ck',
      sql`${t.geofenceRadiusM} is null or ${t.geofenceRadiusM} between 10 and 2000`,
    ),
    check('doctors_lock_cap_ck', sql`${t.maxActiveLocks} between 1 and 5`),
  ],
);

export const chemists = pgTable(
  'chemists',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    territoryId: uuid('territory_id')
      .notNull()
      .references(() => territories.id),
    /** Territory (level 'territory') under the HQ in territory_id (0042); null until backfilled. */
    localTerritoryId: uuid('local_territory_id').references(() => territories.id),
    name: text('name').notNull(),
    gstin: text('gstin'),
    drugLicenseNo: text('drug_license_no'),
    ...contact(),
    ...syncCols(),
  },
  (t) => [
    index('chemists_territory_idx').on(t.companyId, t.territoryId),
    index('chemists_local_territory_idx').on(t.companyId, t.localTerritoryId),
    index('chemists_updated_idx').on(t.companyId, t.updatedAt),
  ],
);

export const stockists = pgTable(
  'stockists',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    territoryId: uuid('territory_id')
      .notNull()
      .references(() => territories.id),
    /** Territory (level 'territory') under the HQ in territory_id (0042); null until backfilled. */
    localTerritoryId: uuid('local_territory_id').references(() => territories.id),
    name: text('name').notNull(),
    gstin: text('gstin'),
    drugLicenseNo: text('drug_license_no'),
    ...contact(),
    ...syncCols(),
  },
  (t) => [
    index('stockists_territory_idx').on(t.companyId, t.territoryId),
    index('stockists_local_territory_idx').on(t.companyId, t.localTerritoryId),
    index('stockists_updated_idx').on(t.companyId, t.updatedAt),
  ],
);
