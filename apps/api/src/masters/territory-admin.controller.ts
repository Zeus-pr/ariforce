import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Id, TerritoryCreate, TerritoryMove, TerritoryUpdate } from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { err } from '../field/checkins.service';
import { TerritoryAdminService } from './territory-admin.service';

const id = (v: string) => {
  if (!Id.safeParse(v).success) throw err(404, 'NOT_FOUND', 'That place was not found');
  return v;
};

@Controller({ path: 'territories', version: '1' })
export class TerritoryAdminController {
  constructor(private readonly svc: TerritoryAdminService) {}

  @Get('health')
  @RequirePermissions('users:write')
  health(@CurrentPrincipal() p: Principal) {
    return this.svc.health(p);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('users:write')
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(TerritoryCreate)) b: z.infer<typeof TerritoryCreate>,
  ) {
    return this.svc.create(p, b);
  }

  @Post(':id/move')
  @RequirePermissions('users:write')
  move(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(TerritoryMove)) b: z.infer<typeof TerritoryMove>,
  ) {
    return this.svc.move(p, id(i), b);
  }

  @Patch(':id')
  @RequirePermissions('users:write')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(TerritoryUpdate)) b: z.infer<typeof TerritoryUpdate>,
  ) {
    return this.svc.update(p, id(i), b);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('users:write')
  remove(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.remove(p, id(i));
  }
}
