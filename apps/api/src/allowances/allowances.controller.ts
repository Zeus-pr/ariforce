import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import {
  AllowancePlaceInput,
  AllowancePlaceQuery,
  AllowancePlaceUpdate,
  AllowanceRateInput,
  AllowanceRateQuery,
  AllowanceRateUpdate,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { AllowancesService } from './allowances.service';

/** TA/DA rate card and fare chart (#39). */
@Controller({ version: '1' })
export class AllowancesController {
  constructor(private readonly svc: AllowancesService) {}

  @Get('allowance-rates')
  @RequirePermissions('me:read')
  listRates(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(AllowanceRateQuery)) q: z.infer<typeof AllowanceRateQuery>,
  ) {
    return this.svc.listRates(p, q);
  }

  @Post('allowance-rates')
  @RequirePermissions('settings:write')
  createRate(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(AllowanceRateInput)) b: z.infer<typeof AllowanceRateInput>,
  ) {
    return this.svc.createRate(p, b);
  }

  @Put('allowance-rates/:id')
  @RequirePermissions('settings:write')
  updateRate(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(AllowanceRateUpdate)) b: z.infer<typeof AllowanceRateUpdate>,
  ) {
    return this.svc.updateRate(p, id, b);
  }

  @Delete('allowance-rates/:id')
  @HttpCode(204)
  @RequirePermissions('settings:write')
  async deleteRate(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    await this.svc.deleteRate(p, id);
  }

  @Get('allowance-places')
  @RequirePermissions('me:read')
  listPlaces(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(AllowancePlaceQuery)) q: z.infer<typeof AllowancePlaceQuery>,
  ) {
    return this.svc.listPlaces(p, q);
  }

  @Post('allowance-places')
  @RequirePermissions('settings:write')
  createPlace(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(AllowancePlaceInput)) b: z.infer<typeof AllowancePlaceInput>,
  ) {
    return this.svc.createPlace(p, b);
  }

  @Put('allowance-places/:id')
  @RequirePermissions('settings:write')
  updatePlace(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(AllowancePlaceUpdate)) b: z.infer<typeof AllowancePlaceUpdate>,
  ) {
    return this.svc.updatePlace(p, id, b);
  }

  @Delete('allowance-places/:id')
  @HttpCode(204)
  @RequirePermissions('settings:write')
  async deletePlace(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    await this.svc.deletePlace(p, id);
  }
}
