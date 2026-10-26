import { sql } from 'drizzle-orm';
import {
  boolean,
  geometry,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, multiPolygon, pk, syncCols } from './_common';

export const companies = pgTable('companies', {
  id: pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  /** Field cycle length (#18). 'month' = calendar month; otherwise fixed N-day cycles from cycleAnchorDate. */
  cycleKind: text('cycle_kind', { enum: ['month', 'days'] })
    .notNull()
    .default('month'),
  cycleLengthDays: integer('cycle_length_days'),
  cycleAnchorDate: text('cycle_anchor_date'),
  /** Default doctor geofence radius in metres (#24). */
  defaultGeofenceM: integer('default_geofence_m').notNull().default(100),
  /** DCR lock: hours after day end before the DCR locks (#23). */
  dcrLockAfterHours: integer('dcr_lock_after_hours').notNull().default(24),
  /** Check-in policy (#24): reject fixes worse than this accuracy (metres). */
  geofenceMaxAccuracyM: integer('geofence_max_accuracy_m').notNull().default(200),
  /** true = reject out-of-fence visits; false = allow and flag. */
  geofenceBlockOutOfFence: boolean('geofence_block_out_of_fence').notNull().default(false),
  geofenceBlockMock: boolean('geofence_block_mock').notNull().default(true),
  ...syncCols(),
});

/**
 * Sales hierarchy (rank 1..8) plus the technical system_admin (rank 0, outside the hierarchy).
 * Renamed from the 0001 values in migration 0006_role_hierarchy (applied DBs keep their rows).
 */
export const roleKey = pgEnum('role_key', [
  'business_manager',
  'area_business_manager',
  'regional_business_manager',
  'zonal_business_manager',
  'sales_manager',
  'general_manager',
  'vice_president',
  'director',
  'system_admin',
  'distribution_head',
  'accountant',
]);

export const roles = pgTable(
  'roles',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    key: roleKey('key').notNull(),
    name: text('name').notNull(),
    rank: integer('rank').notNull(),
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...syncCols(),
  },
  (t) => [uniqueIndex('roles_company_key_uq').on(t.companyId, t.key)],
);

export const userStatus = pgEnum('user_status', ['invited', 'active', 'suspended']);

/** Tenant user / employee profile. `authUserId` links to better-auth identity (#6). */
export const users = pgTable(
  'users',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    authUserId: text('auth_user_id').unique(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    employeeCode: text('employee_code'),
    /** Free-text job title from HR (e.g. "Distribution Head"); independent of the RBAC role. */
    designation: text('designation'),
    /** Reporting manager (people hierarchy; may differ from territory hierarchy). */
    managerId: uuid('manager_id'),
    status: userStatus('status').notNull().default('active'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('users_company_email_uq').on(t.companyId, sql`lower(${t.email})`),
    uniqueIndex('users_company_code_uq').on(t.companyId, t.employeeCode),
    index('users_manager_idx').on(t.companyId, t.managerId),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    createdAt: syncCols().createdAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const territoryLevel = pgEnum('territory_level', [
  'national',
  'zone',
  'region',
  'area',
  'headquarter',
]);

/** Territory tree: National > Zone > Region > Area > HQ. `path` = dot-joined ancestor ids incl. self. */
export const territories = pgTable(
  'territories',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    parentId: uuid('parent_id'),
    level: territoryLevel('level').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    city: text('city'),
    state: text('state'),
    centroid: geometry('centroid', { type: 'point', mode: 'xy', srid: 4326 }),
    boundary: multiPolygon('boundary'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('territories_company_code_uq').on(t.companyId, t.code),
    index('territories_path_idx').on(t.companyId, t.path.op('text_pattern_ops')),
    index('territories_boundary_gix').using('gist', t.boundary),
  ],
);

/** User <-> territory assignment. A manager's scope = subtree of their territories. */
export const userTerritories = pgTable(
  'user_territories',
  {
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    territoryId: uuid('territory_id')
      .notNull()
      .references(() => territories.id),
    isPrimary: boolean('is_primary').notNull().default(true),
    createdAt: syncCols().createdAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.territoryId] })],
);

/**
 * Single-use employee invites. Only the SHA-256 of the token is stored; the token itself travels in
 * the invite link. Accepting creates the auth identity and activates the user.
 */
export const userInvites = pgTable(
  'user_invites',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('user_invites_token_uq').on(t.tokenHash),
    index('user_invites_user_idx').on(t.companyId, t.userId),
  ],
);
