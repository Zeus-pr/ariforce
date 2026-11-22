import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { BotAskRequest } from '@ariforce/contracts';
import type * as z from 'zod';
import { CurrentPrincipal } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { enforce, LIMITS } from '../common/rate-limit';
import { ZodPipe } from '../common/zod.pipe';
import { BotService } from './bot.service';

@Controller({ path: 'bot', version: '1' })
export class BotController {
  constructor(private readonly svc: BotService) {}

  @Post('ask')
  @HttpCode(200)
  async ask(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(BotAskRequest)) b: z.output<typeof BotAskRequest>,
  ) {
    await enforce(
      [{ key: `bot:${p.userId}`, ...LIMITS.botAsk() }],
      'ARIBOT is pausing for an hour. Try again later.',
    );
    return this.svc.ask(p, b.message);
  }
}
