import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  SalesActualCreate,
  SalesActualQuery,
  SalesImportRequest,
  SalesTargetQuery,
  SalesTargetSet,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { SalesService } from './sales.service';

/** Sales targets and actuals: director and system_admin (sales:write). KPI cards read the same data. */
@Controller({ path: 'sales', version: '1' })
@RequirePermissions('sales:write')
export class SalesController {
  constructor(private readonly svc: SalesService) {}

  @Get('targets')
  targets(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(SalesTargetQuery)) q: z.infer<typeof SalesTargetQuery>,
  ) {
    return this.svc.listTargets(p, q);
  }

  @Put('targets')
  setTargets(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(SalesTargetSet)) b: z.infer<typeof SalesTargetSet>,
  ) {
    return this.svc.setTargets(p, b);
  }

  @Get('actuals')
  actuals(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(SalesActualQuery)) q: z.infer<typeof SalesActualQuery>,
  ) {
    return this.svc.listActuals(p, q);
  }

  @Post('actuals')
  createActual(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(SalesActualCreate)) b: z.infer<typeof SalesActualCreate>,
  ) {
    return this.svc.createActual(p, b);
  }

  @Delete('actuals/:id')
  deleteActual(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.svc.deleteActual(p, id);
  }

  @Post('import')
  import(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(SalesImportRequest)) b: z.infer<typeof SalesImportRequest>,
  ) {
    return this.svc.import(p, b);
  }
}
