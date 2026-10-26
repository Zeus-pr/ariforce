import { Controller, Get, Query } from '@nestjs/common';
import { KpiQuery } from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { KpisService } from './kpis.service';

@Controller({ path: 'kpis', version: '1' })
export class KpisController {
  constructor(private readonly svc: KpisService) {}

  @Get()
  @RequirePermissions('reports:read')
  report(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(KpiQuery)) q: z.output<typeof KpiQuery>,
  ) {
    return this.svc.report(p, q);
  }

  @Get('products')
  @RequirePermissions('reports:read')
  products(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(KpiQuery)) q: z.output<typeof KpiQuery>,
  ) {
    return this.svc.products(p, q);
  }
}
