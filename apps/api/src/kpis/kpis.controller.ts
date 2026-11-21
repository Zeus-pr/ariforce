import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { KpiQuery } from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { KpisService } from './kpis.service';

function canReadKpis(p: Principal) {
  if (p.permissions.includes('reports:read')) return;
  if (p.roles.includes('distribution_head') && p.permissions.includes('sales:read')) return;
  throw new ForbiddenException('Missing permission: reports:read');
}

@Controller({ path: 'kpis', version: '1' })
export class KpisController {
  constructor(private readonly svc: KpisService) {}

  @Get()
  report(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(KpiQuery)) q: z.output<typeof KpiQuery>,
  ) {
    canReadKpis(p);
    return this.svc.report(p, q);
  }

  @Get('products')
  products(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(KpiQuery)) q: z.output<typeof KpiQuery>,
  ) {
    canReadKpis(p);
    return this.svc.products(p, q);
  }
}
