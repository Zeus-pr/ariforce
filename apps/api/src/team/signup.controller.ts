import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  Id,
  SignupApprove,
  SignupReject,
  SignupRequestCreate,
  SignupRequestQuery,
} from '@ariforce/contracts';
import type { Request } from 'express';
import type * as z from 'zod';
import { CurrentPrincipal, Public } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp } from '../common/client-ip';
import { SignupService } from './signup.service';
import { TeamService } from './team.service';

/** Self sign-up + approval (docs/RBAC.md "Sign-up requests"). */
@Controller({ version: '1' })
export class SignupController {
  constructor(
    private readonly signup: SignupService,
    private readonly team: TeamService,
  ) {}

  @Public()
  @Post('auth/sign-up-request')
  @HttpCode(202)
  submit(
    @Body(new ZodPipe(SignupRequestCreate)) b: z.infer<typeof SignupRequestCreate>,
    @Req() req: Request,
  ) {
    return this.signup.submit(b, clientIp(req));
  }

  @Public()
  @Get('auth/sign-up-options')
  options(@Req() req: Request) {
    return this.signup.options(clientIp(req));
  }

  @Get('signup-requests')
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodPipe(SignupRequestQuery)) q: z.infer<typeof SignupRequestQuery>,
  ) {
    return this.team.listSignups(p, q.status);
  }

  @Post('signup-requests/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(SignupApprove)) b: z.infer<typeof SignupApprove>,
  ) {
    return this.team.approveSignup(p, id, b);
  }

  @Post('signup-requests/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(SignupReject)) b: z.infer<typeof SignupReject>,
  ) {
    return this.team.rejectSignup(p, id, b.reason);
  }
}
