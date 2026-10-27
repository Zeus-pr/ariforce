import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companyId, pk } from './_common';
import { companies, users } from './tenancy';

/** In-app inbox (#35). RLS: tenant + recipient (docs/NOTIFICATIONS.md). */
export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    dedupeKey: text('dedupe_key').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey),
    index('notifications_inbox_idx').on(t.companyId, t.userId, t.createdAt, t.id),
    index('notifications_unread_idx')
      .on(t.companyId, t.userId)
      .where(sql`read_at is null`),
  ],
);

/** Future external channels (email / sms / push): one row per notification + channel. Unused today. */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: pk(),
    companyId: companyId().references(() => companies.id),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['email', 'sms', 'push'] }).notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'skipped'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('notification_deliveries_uq').on(t.notificationId, t.channel)],
);

/** DB-backed job queue (#35). company_id null = system job. Claimed via jobs_claim(). */
export const jobs = pgTable(
  'jobs',
  {
    id: pk(),
    companyId: uuid('company_id').references(() => companies.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: ['queued', 'running', 'done', 'dead'] })
      .notNull()
      .default('queued'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jobs_ready_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe_uq').on(t.type, t.dedupeKey),
    index('jobs_company_idx').on(t.companyId, t.status),
  ],
);
