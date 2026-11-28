import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { Id, Month } from '@ariforce/contracts';
import type { Response } from 'express';
import * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { VisitBreakdownService } from './visit-breakdown.service';

const QuerySchema = z
  .object({
    month: Month,
    headquartersId: Id.optional(),
    userId: Id.optional(),
  })
  .meta({ id: 'VisitBreakdownQuery' });

@Controller({ path: 'reports/visit-breakdown', version: '1' })
export class VisitBreakdownController {
  constructor(private readonly excel: VisitBreakdownService) {}

  @Get()
  @RequirePermissions('reports:read')
  async download(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(QuerySchema)) q: z.output<typeof QuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buf = await this.excel.file(p, q.month, {
      headquartersId: q.headquartersId,
      userId: q.userId,
    });
    res.setHeader(
      'content-type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('content-disposition', `attachment; filename="doc-chem-visits-${q.month}.xlsx"`);
    res.setHeader('cache-control', 'no-store');
    return new StreamableFile(buf);
  }
}
