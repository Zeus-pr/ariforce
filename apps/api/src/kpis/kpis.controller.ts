import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { KpiQuery, SalesPlacesQuery } from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { KpisService } from './kpis.service';

const DISTRIBUTION_KPIS = new Set([
  'primary_sales_value',
  'primary_achievement_pct',
  'secondary_sales_value',
  'secondary_achievement_pct',
  'growth_vs_ly_pct',
  'pob_value',
]);

function canReadKpis(p: Principal, q: z.output<typeof KpiQuery>) {
  if (p.permissions.includes('reports:read')) return;
  const keys = q.kpis ?? [];
  const salesDesk =
    p.roles.includes('distribution_head') &&
    p.permissions.includes('sales:read') &&
    !q.userId &&
    (q.rollup === 'company' || q.rollup === 'byTerritory') &&
    keys.length > 0 &&
    keys.every((key) => DISTRIBUTION_KPIS.has(key));
  if (salesDesk) return;
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
    canReadKpis(p, q);
    return this.svc.report(p, q);
  }

  @Get('sales-places')
  salesPlaces(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(SalesPlacesQuery)) q: z.output<typeof SalesPlacesQuery>,
  ) {
    canReadKpis(p, {
      rollup: 'byTerritory',
      territoryId: q.territoryId,
      territoryLevel: q.territoryLevel,
      kpis: [
        'primary_sales_value',
        'primary_achievement_pct',
        'secondary_sales_value',
        'secondary_achievement_pct',
      ],
    });
    return this.svc.salesPlaces(p, q);
  }

  @Get('products')
  products(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(KpiQuery)) q: z.output<typeof KpiQuery>,
  ) {
    canReadKpis(p, q);
    return this.svc.products(p, q);
  }
}
