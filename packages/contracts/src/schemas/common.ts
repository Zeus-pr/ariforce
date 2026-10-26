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
  q: z.string().max(100).optional().meta({ description: 'Free-text search' }),
});
export type ListQuery = z.infer<typeof ListQuery>;

export function page<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({ items: z.array(item), nextCursor: z.string().nullable(), serverTime: Timestamp })
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
