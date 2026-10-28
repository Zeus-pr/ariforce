import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { TerritoryLinkImportRequest } from '@ariforce/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { ImportsService } from './imports.service';
import { TerritoryLinksService } from './territory-links.service';

/** Write-class (RBM+/system_admin). Import job + per-row results (error report). Company-wide roles see all jobs; others their own. */
@Controller({ path: 'imports', version: '1' })
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly links: TerritoryLinksService,
  ) {}

  /** Territory link import (docs/TERRITORY-MODEL.md): dry run 200, applied 201. Company-wide roles only. */
  @Post('territory-links')
  @RequirePermissions('imports:write', 'territories:write', 'masters:write')
  territoryLinks(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(TerritoryLinkImportRequest)) body: TerritoryLinkImportRequest,
    @Res({ passthrough: true }) res: { status(n: number): void },
  ) {
    res.status(body.dryRun ? 200 : 201);
    return this.links.run(p, body);
  }

  @Get(':id')
  @RequirePermissions('imports:write')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.imports.get(p, id);
  }
}
