import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ExceptionEvaluateRequest,
  ExceptionListQuery,
  ExceptionNote,
  ExceptionRuleParam,
  ExceptionRuleUpdate,
  ExceptionSummaryQuery,
  ExceptionUpdate,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { ExceptionsService } from './exceptions.service';

/** Exception and Alert Center (#56). Scope and lifecycle rules: docs/EXCEPTIONS.md. */
@Controller({ version: '1' })
export class ExceptionsController {
  constructor(private readonly svc: ExceptionsService) {}

  @Get('exceptions')
  @RequirePermissions('field:read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(ExceptionListQuery)) q: z.output<typeof ExceptionListQuery>,
  ) {
    return this.svc.list(p, q);
  }

  @Get('exceptions/summary')
  @RequirePermissions('field:read')
  summary(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(ExceptionSummaryQuery)) q: z.output<typeof ExceptionSummaryQuery>,
  ) {
    return this.svc.summary(p, q);
  }

  @Post('exceptions/evaluate')
  @HttpCode(202)
  @RequirePermissions('settings:write')
  evaluate(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(ExceptionEvaluateRequest)) b: z.output<typeof ExceptionEvaluateRequest>,
  ) {
    return this.svc.evaluate(p, b);
  }

  @Get('exceptions/:id')
  @RequirePermissions('field:read')
  get(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.svc.get(p, id);
  }

  @Patch('exceptions/:id')
  @RequirePermissions('field:read', 'approvals:decide')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(ExceptionUpdate)) b: z.output<typeof ExceptionUpdate>,
  ) {
    return this.svc.update(p, id, b);
  }

  @Post('exceptions/:id/explain')
  @HttpCode(200)
  @RequirePermissions('field:read')
  explain(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(ExceptionNote)) b: z.output<typeof ExceptionNote>,
  ) {
    return this.svc.explain(p, id, b.note);
  }

  @Post('exceptions/:id/resolve')
  @HttpCode(200)
  @RequirePermissions('field:read', 'approvals:decide')
  resolve(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(ExceptionNote)) b: z.output<typeof ExceptionNote>,
  ) {
    return this.svc.close(p, id, b.note, 'resolved');
  }

  @Post('exceptions/:id/dismiss')
  @HttpCode(200)
  @RequirePermissions('field:read', 'approvals:decide')
  dismiss(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(ExceptionNote)) b: z.output<typeof ExceptionNote>,
  ) {
    return this.svc.close(p, id, b.note, 'dismissed');
  }

  @Get('exception-rules')
  @RequirePermissions('field:read')
  rules(@CurrentPrincipal() p: Principal) {
    return this.svc.rules(p);
  }

  @Put('exception-rules/:code')
  @RequirePermissions('settings:write')
  updateRule(
    @CurrentPrincipal() p: Principal,
    @Param(new ZodPipe(ExceptionRuleParam)) prm: z.output<typeof ExceptionRuleParam>,
    @Body(new ZodPipe(ExceptionRuleUpdate)) b: z.output<typeof ExceptionRuleUpdate>,
  ) {
    return this.svc.updateRule(p, prm.code, b);
  }
}
