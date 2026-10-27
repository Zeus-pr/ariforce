import * as z from 'zod';
import 'zod-openapi';

export const Id = z
  .uuid()
  .meta({ description: 'UUIDv7 identifier', example: '0192f1d2-7c3a-7b4e-9a1f-2b3c4d5e6f70' });
export const Timestamp = z.iso
  .datetime({ offset: true })
  .meta({ description: 'ISO-8601 timestamp (UTC)' });

/** Fields every tenant-scoped resource carries (sync-friendly). */
export const Syncable = z.object({
  id: Id,
  companyId: Id,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  deletedAt: Timestamp.nullable().meta({ description: 'Tombstone: set when soft-deleted' }),
  version: z
    .int()
    .min(1)
    .meta({ description: 'Row version, incremented on every update (optimistic concurrency)' }),
});

export const ErrorBody = z
  .object({
    error: z.object({
      code: z.string().meta({ example: 'FORBIDDEN' }),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .meta({ id: 'Error' });
export type ErrorBody = z.infer<typeof ErrorBody>;

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  cursor: z.string().optional().meta({ description: 'Opaque cursor from `nextCursor`' }),
  updatedSince: Timestamp.optional().meta({
    description: 'Delta sync: only rows with updatedAt > this (includes tombstones)',
  }),
  q: z.string().max(100).optional().meta({ description: 'Free-text search (name, code)' }),
  sort: z.string().max(40).optional().meta({
    description:
      '`field` ascending or `-field` descending. Allowed fields are listed per endpoint; unknown fields return 422.',
    example: '-updatedAt',
  }),
  includeTotal: z
    .enum(['true', 'false'])
    .optional()
    .meta({ description: 'When `true`, the page carries `total` (ignored with updatedSince)' }),
});
export type ListQuery = z.infer<typeof ListQuery>;

export function page<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({
      items: z.array(item),
      nextCursor: z.string().nullable(),
      serverTime: Timestamp,
      total: z
        .int()
        .min(0)
        .optional()
        .meta({ description: 'Rows matching the filters; present when includeTotal=true' }),
    })
    .meta({ id });
}

export const IdParam = z.object({ id: Id });
export const IdempotencyKeyHeader = z.object({
  'idempotency-key': z
    .string()
    .max(128)
    .optional()
    .meta({ description: 'Client-generated key; safe retries for POST' }),
});

export const DateOnly = z.iso.date().meta({ description: 'Calendar date (YYYY-MM-DD, IST)' });
export const Month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .meta({ description: 'Month (YYYY-MM)', example: '2026-11' });
export const GeoPoint = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .meta({ id: 'GeoPoint' });

/** Builds a list query with a sort allow-list and extra filters. */
export function listQuery<S extends readonly [string, ...string[]], F extends z.ZodRawShape>(
  sortFields: S,
  filters: F,
) {
  const allowed = sortFields.flatMap((f) => [f, `-${f}`]) as [string, ...string[]];
  return ListQuery.extend({
    sort: z
      .enum(allowed)
      .optional()
      .meta({ description: `Sort: ${sortFields.join(', ')} (prefix - for descending)` }),
    ...filters,
  });
}

/** A user's id and display name. */
export const UserRef = z.object({ id: Id, name: z.string() }).meta({ id: 'UserRef' });
export type UserRef = z.infer<typeof UserRef>;
