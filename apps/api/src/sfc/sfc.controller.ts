import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { SfcEmployeeQuery, SfcSettings, SfcTablePut } from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { SfcService } from './sfc.service';

/** SFC (Standard Fare Chart), docs/SFC.md. */
@Controller({ path: 'sfc', version: '1' })
export class SfcController {
  constructor(private readonly svc: SfcService) {}

  @Get('settings')
  @RequirePermissions('sfc:read')
  settings(@CurrentPrincipal() p: Principal) {
    return this.svc.settings(p);
  }

  @Put('settings')
  @RequirePermissions('settings:write')
  putSettings(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(SfcSettings)) b: SfcSettings) {
    return this.svc.putSettings(p, b);
  }

  @Get('hqs')
  @RequirePermissions('sfc:read')
  hqs(@CurrentPrincipal() p: Principal) {
    return this.svc.hqs(p);
  }

  @Get('employees')
  @RequirePermissions('sfc:read')
  employees(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(SfcEmployeeQuery)) q: z.infer<typeof SfcEmployeeQuery>,
  ) {
    return this.svc.employees(p, q.territoryId);
  }

  @Get('employees/:userId/routes')
  @RequirePermissions('sfc:read')
  get(@CurrentPrincipal() p: Principal, @Param('userId') userId: string) {
    return this.svc.get(p, userId);
  }

  @Put('employees/:userId/routes')
  @RequirePermissions('sfc:write')
  put(
    @CurrentPrincipal() p: Principal,
    @Param('userId') userId: string,
    @Body(new ZodPipe(SfcTablePut)) b: SfcTablePut,
  ) {
    return this.svc.put(p, userId, b);
  }
}
