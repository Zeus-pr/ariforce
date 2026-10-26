import { Controller, Get, Param } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ImportsService } from './imports.service';

/** Write-class (RBM+/system_admin). Import job + per-row results (error report). Company-wide roles see all jobs; others their own. */
@Controller({ path: 'imports', version: '1' })
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get(':id')
  @RequirePermissions('imports:write')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.imports.get(p, id);
  }
}
