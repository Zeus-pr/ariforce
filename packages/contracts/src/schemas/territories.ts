import * as z from 'zod';
import { Id, Syncable, listQuery } from './common';
import { RoleKey } from './roles';

export const TerritoryLevel = z
  .enum(['national', 'zone', 'region', 'area', 'headquarter', 'territory'])
  .meta({ id: 'TerritoryLevel' });
export type TerritoryLevel = z.infer<typeof TerritoryLevel>;

/** Levels, top first. */
export const TERRITORY_LEVELS = TerritoryLevel.options;

/**
 * Which territory levels a role may hold (Part 3). A Business Manager holds headquarter-level
 * territories only; ABM and above may hold a headquarter or anything higher. Roles outside the
 * hierarchy (system admin) may hold any level above 'territory'. A 'territory' (unit under an HQ,
 * migration 0042) groups doctors/chemists/stockists and is never assigned to people. Enforced on writes as
 * 422 TERRITORY_LEVEL_INVALID.
 */
export const PEOPLE_TERRITORY_LEVELS = TERRITORY_LEVELS.filter((l) => l !== 'territory');
export const assignableTerritoryLevels = (role: RoleKey): readonly TerritoryLevel[] =>
  role === 'business_manager' ? ['headquarter'] : PEOPLE_TERRITORY_LEVELS;

export const Territory = Syncable.extend({
  parentId: Id.nullable(),
  level: TerritoryLevel,
  code: z.string().max(32),
  name: z.string().max(120),
  path: z.string().meta({
    description:
      'Materialised path, root first, dot-separated; segments are codes (production) or ids (seed)',
  }),
  centroid: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable(),
}).meta({ id: 'Territory' });
export type Territory = z.infer<typeof Territory>;

export const TerritoryListQuery = listQuery(['code', 'name', 'level', 'updatedAt'] as const, {
  level: TerritoryLevel.optional(),
  parentId: Id.optional(),
  ancestorId: Id.optional().meta({ description: 'Only descendants of this territory' }),
  code: z.string().max(32).optional().meta({ description: 'Exact code match (import lookup)' }),
  assignableForRole: RoleKey.optional().meta({
    description:
      'Only territories this role may hold (business_manager: headquarter only; others: any level). Combine with level.',
  }),
}).meta({
  description: 'Cursor-paginated; page through with nextCursor for more than 200 territories',
});

/** GET /v1/territories/compact: id/name/level/parentId only, for pickers and tree building. */
export const TerritoryCompactQuery = z
  .object({
    level: TerritoryLevel.optional(),
    parentId: Id.optional(),
    ancestorId: Id.optional().meta({ description: 'Only descendants of this territory' }),
    limit: z.coerce.number().int().min(1).max(2000).default(2000).optional().meta({
      description: 'Page size, default and max 2000 (the full list caps at 200)',
    }),
    cursor: z.string().optional().meta({ description: 'Opaque cursor from `nextCursor`' }),
  })
  .meta({ id: 'TerritoryCompactQuery' });
export const TerritoryCompactHeaders = z.object({
  'if-none-match': z.string().max(200).optional().meta({
    description: 'ETag from a previous response; 304 with empty body if unchanged',
  }),
});
export const TerritoryCompact = z
  .object({ id: Id, name: z.string(), level: TerritoryLevel, parentId: Id.nullable() })
  .meta({ id: 'TerritoryCompact' });
export type TerritoryCompact = z.infer<typeof TerritoryCompact>;
export const TerritoryCompactList = z
  .object({ items: z.array(TerritoryCompact), nextCursor: z.string().nullable() })
  .meta({ id: 'TerritoryCompactList' });
export type TerritoryCompactList = z.infer<typeof TerritoryCompactList>;

const TerritoryName = z.string().trim().min(1).max(120);
const TerritoryCode = z.string().trim().min(1).max(32);

export const TerritoryCreate = z
  .object({
    name: TerritoryName,
    code: TerritoryCode.optional(),
    level: TerritoryLevel,
    parentId: Id.nullable(),
  })
  .meta({ id: 'TerritoryCreate' });
export type TerritoryCreate = z.infer<typeof TerritoryCreate>;

export const TerritoryUpdate = z
  .object({
    version: z.int().min(1),
    name: TerritoryName.optional(),
    code: TerritoryCode.optional(),
  })
  .meta({ id: 'TerritoryUpdate' });
export type TerritoryUpdate = z.infer<typeof TerritoryUpdate>;

export const TerritoryMove = z
  .object({ version: z.int().min(1), parentId: Id })
  .meta({ id: 'TerritoryMove' });
export type TerritoryMove = z.infer<typeof TerritoryMove>;

export const TERRITORY_HEALTH_CODES = [
  'no_territory',
  'sfc_hq_invisible',
  'bm_without_hq',
  'hq_without_bm',
  'area_without_holder',
  'assignment_to_deleted',
] as const;
export const TerritoryHealth = z
  .object({
    items: z.array(
      z.object({
        code: z.enum(TERRITORY_HEALTH_CODES),
        count: z.int().min(0),
        people: z
          .array(z.object({ id: Id, name: z.string(), territoryId: Id.nullable() }))
          .default([]),
        places: z.array(z.object({ id: Id, name: z.string() })).default([]),
      }),
    ),
  })
  .meta({ id: 'TerritoryHealth' });
export type TerritoryHealth = z.infer<typeof TerritoryHealth>;
