import { createHash } from 'node:crypto';
import { Controller, Get, Headers, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type * as z from 'zod';
import { TerritoryCompactQuery, masterReadPermission } from '@ariforce/contracts';
import { territories } from '@ariforce/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { ZodPipe } from '../common/zod.pipe';
import { inSubtree } from './master-defs';
import { decodeCursor, encodeCursor } from './masters.service';

/**
 * Compact territory list. Same company (RLS) and caller-subtree scope as GET /v1/territories,
 * non-deleted rows only, same name order. Weak ETag over the page; private, max-age 60s.
 * Registered before the generated territories controller so 'compact' is not taken as an :id.
 */
@Controller({ path: 'territories', version: '1' })
export class TerritoriesCompactController {
  constructor(@Inject(TenantService) private readonly tenant: TenantService) {}

  @Get('compact')
  @RequirePermissions(masterReadPermission('territories'))
  async compact(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(TerritoryCompactQuery)) q: z.infer<typeof TerritoryCompactQuery>,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const limit = q.limit ?? 2000;
    const offset = decodeCursor(q.cursor);
    const rows = await this.tenant.run(p, (tx) =>
      tx
        .select({
          id: territories.id,
          name: territories.name,
          level: territories.level,
          parentId: territories.parentId,
        })
        .from(territories)
        .where(
          and(
            isNull(territories.deletedAt),
            this.tenant.scope(p, territories.path),
            q.level ? eq(territories.level, q.level) : undefined,
            q.parentId ? eq(territories.parentId, q.parentId) : undefined,
            q.ancestorId ? inSubtree(territories.id, q.ancestorId) : undefined,
          ),
        )
        .orderBy(asc(sql`lower(${territories.name})`), asc(territories.id))
        .limit(limit + 1)
        .offset(offset),
    );
    const body = {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    };
    const etag = `W/"tc-${createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 27)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=60');
    if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
      res.status(304);
      return;
    }
    return body;
  }
}
