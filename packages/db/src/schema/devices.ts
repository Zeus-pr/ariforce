import {
  bigint,
  boolean,
  geometry,
  index,
  inet,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { companyId, pk, syncCols } from './_common';
import { companies, users } from './tenancy';

export const deviceOwnership = pgEnum('device_ownership', ['company', 'personal']);
export const devicePlatform = pgEnum('device_platform', ['android', 'ios']);
export const deviceStatus = pgEnum('device_status', ['pending_consent', 'active', 'revoked']);

/**
 * Enrolled phones (Android + iPhone via Expo). Company-issued or personal (BYOD).
 * A personal device becomes `active` only after a `consent_records` row with granted = true
 * for purpose `personal_device_enrolment` (and `location_checkin` before any geo capture).
 */
export const devices = pgTable(
  'devices',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    ownership: deviceOwnership('ownership').notNull(),
    platform: devicePlatform('platform').notNull(),
    /** App-generated install id (stable per install; not IMEI/advertising id). */
    installId: text('install_id').notNull(),
    model: text('model'),
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    /** Company asset tag for company-issued phones. */
    assetTag: text('asset_tag'),
    status: deviceStatus('status').notNull().default('pending_consent'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('devices_company_install_uq').on(t.companyId, t.installId),
    index('devices_user_idx').on(t.companyId, t.userId),
  ],
);

export const consentPurpose = pgEnum('consent_purpose', [
  'personal_device_enrolment',
  'location_checkin',
]);

/**
 * Append-only DPDP consent ledger. Withdrawal = a new row with granted = false.
 * `noticeVersion` identifies the exact notice text shown (docs/notices/*).
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: uuid('device_id').references(() => devices.id),
    purpose: consentPurpose('purpose').notNull(),
    noticeVersion: text('notice_version').notNull(),
    granted: boolean('granted').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('consent_user_purpose_idx').on(t.companyId, t.userId, t.purpose, t.at)],
);

/** GPS is captured ONLY at these events. There is deliberately no continuous location trail. */
export const geoCaptureKind = pgEnum('geo_capture_kind', [
  'punch_in',
  'visit',
  'punch_out',
  'geo_tag',
]);
export const geoSource = pgEnum('geo_source', ['gps', 'network', 'fused', 'manual']);

/** Append-only point captures (punch-in, each visit, punch-out, doctor geo-tag). */
export const geoCaptures = pgTable(
  'geo_captures',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    kind: geoCaptureKind('kind').notNull(),
    location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    accuracyM: real('accuracy_m'),
    source: geoSource('source').notNull(),
    /** OS-reported mock/fake location flag. */
    isMock: boolean('is_mock').notNull().default(false),
    /** What the capture belongs to (e.g. 'visit', 'attendance', 'doctor'). */
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    /** Distance to the target's geofence centre, computed server-side. */
    distanceM: bigint('distance_m', { mode: 'number' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('geo_captures_user_at_idx').on(t.companyId, t.userId, t.capturedAt),
    index('geo_captures_entity_idx').on(t.companyId, t.entityType, t.entityId),
  ],
);
