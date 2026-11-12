import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import {
  DoctorLockCap,
  OutletKind as OutletKindSchema,
  OutletLocationCreate,
  OutletLocationPatch,
} from '@ariforce/contracts';
import type { Response } from 'express';
import * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { OutletLocationsService } from './outlet-locations.service';

const KindParam = z.object({ kind: OutletKindSchema, id: z.string().uuid() });
const IdParam = z.object({ id: z.string().uuid() });

@Controller({ version: '1' })
export class OutletLocationsController {
  constructor(private readonly svc: OutletLocationsService) {}

  @Get('outlets/:kind/:id/locations')
  @RequirePermissions('field:read')
  list(
    @CurrentPrincipal() p: Principal,
    @Param(new ZodPipe(KindParam)) path: z.infer<typeof KindParam>,
  ) {
    return this.svc.list(p, path.kind, path.id);
  }

  @Post('outlets/:kind/:id/locations')
  @RequirePermissions('field:write')
  async create(
    @CurrentPrincipal() p: Principal,
    @Param(new ZodPipe(KindParam)) path: z.infer<typeof KindParam>,
    @Body(new ZodPipe(OutletLocationCreate)) b: OutletLocationCreate,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.svc.create(p, path.kind, path.id, b);
    res.status(r.replay ? 200 : 201);
    return r.body;
  }

  @Patch('outlets/:kind/:id/lock-cap')
  @RequirePermissions('field:write')
  setLockCap(
    @CurrentPrincipal() p: Principal,
    @Param(new ZodPipe(KindParam)) path: z.infer<typeof KindParam>,
    @Body(new ZodPipe(DoctorLockCap)) b: DoctorLockCap,
  ) {
    return this.svc.setLockCap(p, path.kind, path.id, b.maxActiveLocks);
  }

  @Patch('outlet-locations/:id')
  @RequirePermissions('field:write')
  patch(
    @CurrentPrincipal() p: Principal,
    @Param(new ZodPipe(IdParam)) path: z.infer<typeof IdParam>,
    @Body(new ZodPipe(OutletLocationPatch)) b: OutletLocationPatch,
  ) {
    return this.svc.patch(p, path.id, b);
  }
}
