import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { PasswordForgot, PasswordReset } from '@ariforce/contracts';
import type { Request } from 'express';
import type * as z from 'zod';
import { clientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { Public } from './decorators';
import { PasswordResetService } from './password-reset.service';

/** Forgot password (docs/AUTH-PASSWORD-RESET.md). Public; handled by Nest, not better-auth's router. */
@Controller({ path: 'auth/password', version: '1' })
export class PasswordResetController {
  constructor(private readonly svc: PasswordResetService) {}

  @Public()
  @Post('forgot')
  @HttpCode(200)
  forgot(
    @Body(new ZodPipe(PasswordForgot)) b: z.infer<typeof PasswordForgot>,
    @Req() req: Request,
  ) {
    return this.svc.forgot(b, clientIp(req));
  }

  @Public()
  @Post('reset')
  @HttpCode(200)
  reset(@Body(new ZodPipe(PasswordReset)) b: z.infer<typeof PasswordReset>, @Req() req: Request) {
    return this.svc.reset(b, clientIp(req));
  }
}
