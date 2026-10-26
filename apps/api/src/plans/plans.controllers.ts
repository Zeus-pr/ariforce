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
  ApprovalDecision,
  ApprovalListQuery,
  Id,
  Month,
  StandardTourPlanUpsert,
  TourPlanCopy,
  TourPlanListQuery,
  TourPlanUpsert,
} from '@ariforce/contracts';
import * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { err } from '../field/checkins.service';
import { ApprovalsService, type ApprovalQuery } from './approvals.service';
import { TourPlansService, type TourPlanQuery } from './tour-plans.service';

const month = (m: string) => {
  if (!Month.safeParse(m).success) throw err(422, 'VALIDATION', 'month must be YYYY-MM');
  return m;
};
const UserQ = z.object({ userId: Id.optional() });

/** Own plans need only a session (everyone plans their month); team reads need field:read. */
@Controller({ path: 'tour-plans', version: '1' })
export class TourPlansController {
  constructor(private readonly svc: TourPlansService) {}

  @Get()
  @RequirePermissions('me:read')
  list(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(TourPlanListQuery)) q: TourPlanQuery) {
    return this.svc.list(p, q);
  }

  @Get('standard')
  @RequirePermissions('me:read')
  getStandard(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(UserQ)) q: z.infer<typeof UserQ>,
  ) {
    return this.svc.getStandard(p, q.userId);
  }

  @Put('standard')
  @RequirePermissions('me:read')
  putStandard(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(StandardTourPlanUpsert)) b: z.infer<typeof StandardTourPlanUpsert>,
  ) {
    return this.svc.putStandard(p, b.days, b.version);
  }

  @Get(':month')
  @RequirePermissions('me:read')
  get(
    @CurrentPrincipal() p: Principal,
    @Param('month') m: string,
    @Query(new ZodPipe(UserQ)) q: z.infer<typeof UserQ>,
  ) {
    return this.svc.get(p, month(m), q.userId);
  }

  @Put(':month')
  @RequirePermissions('me:read')
  put(
    @CurrentPrincipal() p: Principal,
    @Param('month') m: string,
    @Body(new ZodPipe(TourPlanUpsert)) b: z.infer<typeof TourPlanUpsert>,
  ) {
    return this.svc.upsert(p, month(m), b.days, b.version);
  }

  @Post(':month/copy')
  @HttpCode(200)
  @RequirePermissions('me:read')
  copy(
    @CurrentPrincipal() p: Principal,
    @Param('month') m: string,
    @Body(new ZodPipe(TourPlanCopy)) b: z.infer<typeof TourPlanCopy>,
  ) {
    return this.svc.copy(p, month(m), b);
  }

  @Post(':month/submit')
  @HttpCode(200)
  @RequirePermissions('me:read')
  submit(@CurrentPrincipal() p: Principal, @Param('month') m: string) {
    return this.svc.submit(p, month(m));
  }
}

@Controller({ path: 'approvals', version: '1' })
export class ApprovalsController {
  constructor(private readonly svc: ApprovalsService) {}

  @Get()
  @RequirePermissions('me:read')
  list(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(ApprovalListQuery)) q: ApprovalQuery) {
    return this.svc.list(p, q);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('approvals:decide')
  decide(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodPipe(ApprovalDecision)) b: z.infer<typeof ApprovalDecision>,
  ) {
    if (!Id.safeParse(id).success) throw new NotFoundException('Approval not found');
    return this.svc.decide(p, id, b);
  }
}
