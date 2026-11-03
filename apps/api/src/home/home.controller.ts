import { Controller, Get, Query } from '@nestjs/common';
import { MeKpiQuery, PlannedDoctorsQuery } from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { HomeService } from './home.service';

/** Home screen (own data; any signed-in user, no extra permission). */
@Controller({ path: 'me', version: '1' })
export class HomeController {
  constructor(private readonly svc: HomeService) {}

  @Get('attention')
  attention(@CurrentPrincipal() p: Principal) {
    return this.svc.attention(p);
  }

  @Get('today')
  today(@CurrentPrincipal() p: Principal) {
    return this.svc.today(p);
  }

  @Get('planned-doctors')
  planned(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(PlannedDoctorsQuery)) q: z.output<typeof PlannedDoctorsQuery>,
  ) {
    return this.svc.plannedDoctors(p, q);
  }

  @Get('kpis')
  kpis(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(MeKpiQuery)) q: z.output<typeof MeKpiQuery>,
  ) {
    return this.svc.kpis(p, q);
  }
}
