import { Public } from '../auth/decorators';
import { Controller, Get } from '@nestjs/common';

@Public()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  @Get()
  get() {
    return { status: 'ok' as const };
  }
}
