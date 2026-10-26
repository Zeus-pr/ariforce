import { customType, integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** UUIDv7 primary key (time-ordered, client-generatable for offline sync). */
export const pk = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** Tenant key. NOT NULL on every tenant table; RLS policies key on it. */
export const companyId = () => uuid('company_id').notNull();

/** Sync/audit columns: timestamps, tombstone, row version (bumped by trigger). */
export const syncCols = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
});

/** PostGIS MultiPolygon (SRID 4326) as EWKT/GeoJSON text at the driver level. */
export const multiPolygon = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon, 4326)',
});
