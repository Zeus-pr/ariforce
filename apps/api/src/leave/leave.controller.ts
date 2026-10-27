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
  Id,
  LeaveApply,
  LeaveBalanceQuery,
  LeaveCalendarQuery,
  LeaveCancel,
  LeaveCarryForward,
  LeaveCode,
  LeaveDecision,
  LeaveGrantCreate,
  LeaveGrantQuery,
  LeaveRequestQuery,
  LeaveSettingsUpdate,
  LeaveTypeUpdate,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { LeaveService } from './leave.service';

const id = (v: string) => {
  if (!Id.safeParse(v).success) throw new NotFoundException('Leave request not found');
  return v;
};

/** Leave (#51). Row visibility is enforced in the service (own / reporting line). */
@Controller({ path: 'leave', version: '1' })
export class LeaveController {
  constructor(private readonly svc: LeaveService) {}

  @Get('types')
  @RequirePermissions('me:read')
  types(@CurrentPrincipal() p: Principal) {
    return this.svc.types(p);
  }

  @Put('types/:code')
  @RequirePermissions('settings:write')
  putType(
    @CurrentPrincipal() p: Principal,
    @Param('code') code: string,
    @Body(new ZodPipe(LeaveTypeUpdate)) b: z.infer<typeof LeaveTypeUpdate>,
  ) {
    if (!LeaveCode.safeParse(code).success) throw new NotFoundException('Leave type not found');
    return this.svc.putType(p, code, b);
  }

  @Get('settings')
  @RequirePermissions('me:read')
  settings(@CurrentPrincipal() p: Principal) {
    return this.svc.getSettings(p);
  }

  @Put('settings')
  @RequirePermissions('settings:write')
  putSettings(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(LeaveSettingsUpdate)) b: z.infer<typeof LeaveSettingsUpdate>,
  ) {
    return this.svc.putSettings(p, b);
  }

  @Get('balances')
  @RequirePermissions('leave:read')
  balances(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(LeaveBalanceQuery)) q: z.infer<typeof LeaveBalanceQuery>,
  ) {
    return this.svc.balances(p, q);
  }

  @Get('requests')
  @RequirePermissions('leave:read')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(LeaveRequestQuery)) q: z.infer<typeof LeaveRequestQuery>,
  ) {
    return this.svc.list(p, q);
  }

  @Post('requests')
  @HttpCode(201)
  @RequirePermissions('leave:write')
  apply(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(LeaveApply)) b: z.infer<typeof LeaveApply>,
  ) {
    return this.svc.apply(p, b);
  }

  @Get('requests/:id')
  @RequirePermissions('leave:read')
  get(@CurrentPrincipal() p: Principal, @Param('id') i: string) {
    return this.svc.get(p, id(i));
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('leave:read')
  cancel(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(LeaveCancel)) b: z.infer<typeof LeaveCancel>,
  ) {
    return this.svc.cancel(p, id(i), b.reason);
  }

  @Post('requests/:id/decision')
  @HttpCode(200)
  @RequirePermissions('leave:approve', 'approvals:decide')
  decide(
    @CurrentPrincipal() p: Principal,
    @Param('id') i: string,
    @Body(new ZodPipe(LeaveDecision)) b: z.infer<typeof LeaveDecision>,
  ) {
    return this.svc.decide(p, id(i), b);
  }

  @Get('grants')
  @RequirePermissions('leave:read')
  grants(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(LeaveGrantQuery)) q: z.infer<typeof LeaveGrantQuery>,
  ) {
    return this.svc.grants(p, q);
  }

  @Post('grants')
  @HttpCode(201)
  @RequirePermissions('leave:approve')
  grant(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(LeaveGrantCreate)) b: z.infer<typeof LeaveGrantCreate>,
  ) {
    return this.svc.grant(p, b);
  }

  @Post('carry-forward')
  @HttpCode(200)
  @RequirePermissions('settings:write')
  carryForward(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(LeaveCarryForward)) b: z.infer<typeof LeaveCarryForward>,
  ) {
    return this.svc.carryForward(p, b.fromYear);
  }

  @Get('calendar')
  @RequirePermissions('leave:read')
  calendar(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(LeaveCalendarQuery)) q: z.infer<typeof LeaveCalendarQuery>,
  ) {
    return this.svc.calendar(p, q);
  }
}
