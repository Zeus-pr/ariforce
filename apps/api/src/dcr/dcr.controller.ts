import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CompetitorBrandQuery,
  DcrCorrectionRequest,
  DcrListQuery,
  DcrUpsert,
  Id,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { DcrService, type DcrQuery } from './dcr.service';

@Controller({ path: 'dcrs', version: '1' })
export class DcrController {
  constructor(private readonly svc: DcrService) {}

  @Get()
  @RequirePermissions('field:read')
  list(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(DcrListQuery)) q: DcrQuery) {
    return this.svc.list(p, q);
  }

  @Put()
  @RequirePermissions('field:write')
  upsert(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(DcrUpsert)) b: z.infer<typeof DcrUpsert>,
  ) {
    return this.svc.upsert(p, b);
  }

  @Post('correction-requests')
  @HttpCode(201)
  @RequirePermissions('field:write')
  correction(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(DcrCorrectionRequest)) b: z.infer<typeof DcrCorrectionRequest>,
  ) {
    return this.svc.requestCorrection(p, b.date, b.reason);
  }

  @Get(':id')
  @RequirePermissions('field:read')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    if (!Id.safeParse(id).success) throw new NotFoundException('DCR not found');
    return this.svc.get(p, id);
  }
}

@Controller({ path: 'rcpa', version: '1' })
export class RcpaController {
  constructor(private readonly svc: DcrService) {}

  @Get('competitor-brands')
  @RequirePermissions('field:read')
  competitorBrands(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(CompetitorBrandQuery)) q: z.infer<typeof CompetitorBrandQuery>,
  ) {
    return this.svc.competitorBrands(p, q);
  }
}
