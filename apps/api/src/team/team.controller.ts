import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  EmployeeCreate,
  EmployeeUpdate,
  Id,
  InviteAccept,
  ManagerAssign,
} from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal, Public } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { TeamService } from './team.service';

/** Rank/scope rules are enforced in TeamService (docs/RBAC.md "Team and employees"). */
@Controller({ version: '1' })
export class TeamController {
  constructor(private readonly svc: TeamService) {}

  @Get('team')
  tree(@CurrentPrincipal() p: Principal) {
    return this.svc.tree(p);
  }

  @Post('team/:id/manager')
  @HttpCode(200)
  assign(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(ManagerAssign)) b: z.infer<typeof ManagerAssign>,
  ) {
    return this.svc.assignManager(p, id, b.managerId);
  }

  @Post('employees')
  @HttpCode(201)
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(EmployeeCreate)) b: z.infer<typeof EmployeeCreate>,
  ) {
    return this.svc.create(p, b);
  }

  @Patch('employees/:id')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(EmployeeUpdate)) b: z.infer<typeof EmployeeUpdate>,
  ) {
    return this.svc.update(p, id, b);
  }

  @Post('employees/:id/invite')
  @HttpCode(201)
  reinvite(@CurrentPrincipal() p: Principal, @Param('id', new ZodPipe(Id)) id: string) {
    return this.svc.reinvite(p, id);
  }

  @Public()
  @Post('invites/accept')
  @HttpCode(200)
  accept(@Body(new ZodPipe(InviteAccept)) b: z.infer<typeof InviteAccept>) {
    return this.svc.accept(b.token, b.password);
  }
}
