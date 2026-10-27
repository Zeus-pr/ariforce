import * as z from 'zod';
import { Id, Syncable, listQuery } from './common';
import { RoleKey } from './roles';

export const TerritoryLevel = z
  .enum(['national', 'zone', 'region', 'area', 'headquarter'])
  .meta({ id: 'TerritoryLevel' });
export type TerritoryLevel = z.infer<typeof TerritoryLevel>;

/** Levels, top first. */
export const TERRITORY_LEVELS = TerritoryLevel.options;

/**
 * Which territory levels a role may hold (Part 3). A Business Manager holds headquarter-level
 * territories only; ABM and above may hold a headquarter or anything higher. Roles outside the
 * hierarchy (system admin) are unrestricted. Enforced on writes as 422 TERRITORY_LEVEL_INVALID.
 */
export const assignableTerritoryLevels = (role: RoleKey): readonly TerritoryLevel[] =>
  role === 'business_manager' ? ['headquarter'] : TERRITORY_LEVELS;

export const Territory = Syncable.extend({
  parentId: Id.nullable(),
  level: TerritoryLevel,
  code: z.string().max(32),
  name: z.string().max(120),
  path: z.string().meta({ description: 'Materialised path of ids, root first, dot-separated' }),
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
