import * as z from 'zod';
import { Id, Syncable, listQuery } from './common';

export const TerritoryLevel = z
  .enum(['national', 'zone', 'region', 'area', 'headquarter'])
  .meta({ id: 'TerritoryLevel' });
export type TerritoryLevel = z.infer<typeof TerritoryLevel>;

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
}).meta({
  description: 'Cursor-paginated; page through with nextCursor for more than 200 territories',
});
