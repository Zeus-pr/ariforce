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
  ...syncCols(),
});

export const roleKey = pgEnum('role_key', [
  'rep',
  'area_manager',
  'regional_manager',
  'zonal_manager',
  'national_head',
  'admin',
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
