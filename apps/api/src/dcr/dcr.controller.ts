import {
  Body,
  Controller,
  Delete,
  Headers,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CompetitorBrandQuery,
  DcrCorrectionRequest,
  DcrDraftPut,
  DcrListQuery,
  DcrOptionsQuery,
  DcrProductsQuery,
  DcrDecision,
  DcrSfcMatchQuery,
  DcrSubmit,
  DcrSubmitHeaders,
  DcrWorkWithQuery,
  DcrUpsert,
  Id,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { err } from '../field/checkins.service';
import { DcrFlowService } from './dcr-flow.service';
import { DcrReviewService } from './dcr-review.service';
import { DcrService, type DcrQuery } from './dcr.service';

@Controller({ path: 'dcrs', version: '1' })
export class DcrController {
  constructor(
    private readonly svc: DcrService,
    private readonly flow: DcrFlowService,
    private readonly review: DcrReviewService,
  ) {}

  /** Manager review: approve, or reject with a comment (stored as rejectionReason). */
  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('dcr:review')
  decision(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(DcrDecision)) b: z.infer<typeof DcrDecision>,
  ) {
    if (!Id.safeParse(id).success) throw new NotFoundException('DCR not found');
    return this.review.decision(p, id, b);
  }

  @Get('options')
  @RequirePermissions('field:read')
  options(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(DcrOptionsQuery)) q: z.infer<typeof DcrOptionsQuery>,
  ) {
    return this.flow.options(p, q.date, q.includeProducts !== 'false');
  }

  /** Product pickers (split out of options). ETag + If-None-Match -> 304; private, max-age 60s. */
  @Get('products')
  @RequirePermissions('field:read')
  async products(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(DcrProductsQuery)) q: z.infer<typeof DcrProductsQuery>,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.flow.products(p, q.ids?.split(','), ifNoneMatch);
    res.setHeader('ETag', r.etag);
    res.setHeader('Cache-Control', 'private, max-age=60');
    if (!r.body) {
      res.status(304);
      return;
    }
    return r.body;
  }

  @Get('territories')
  @RequirePermissions('field:read')
  territories(@CurrentPrincipal() p: Principal) {
    return this.flow.territories(p);
  }

  @Get('work-with')
  @RequirePermissions('field:read')
  workWith(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(DcrWorkWithQuery)) q: z.infer<typeof DcrWorkWithQuery>,
  ) {
    return this.flow.workWith(p, q);
  }

  @Get('sfc-match')
  @RequirePermissions('field:read')
  sfcMatch(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(DcrSfcMatchQuery)) q: z.infer<typeof DcrSfcMatchQuery>,
  ) {
    return this.flow.sfcMatch(p, q);
  }

  @Put('draft')
  @RequirePermissions('field:write')
  draft(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(DcrDraftPut)) b: z.infer<typeof DcrDraftPut>,
  ) {
    return this.flow.draft(p, b);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('field:write')
  submit(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(DcrSubmit)) b: z.infer<typeof DcrSubmit>,
  ) {
    if (!Id.safeParse(id).success) throw new NotFoundException('DCR not found');
    const h = DcrSubmitHeaders.safeParse({ 'idempotency-key': key });
    if (!h.success)
      throw err(422, 'VALIDATION', 'Idempotency-Key header is required (1-128 chars)', {
        field: 'Idempotency-Key',
      });
    return this.flow.submit(p, id, b.version, h.data['idempotency-key']);
  }

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

  /** Multi-draft: delete one of your drafts (soft delete with its calls and SFC choices). */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('field:write')
  async remove(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    if (!Id.safeParse(id).success) throw new NotFoundException('DCR not found');
    await this.flow.remove(p, id);
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
