import { Public } from '../auth/decorators';
import { Controller, Get } from '@nestjs/common';
import type { Health } from '@ariforce/contracts';
import { WorkTypesCheck } from './work-types.check';

/** Liveness: status is always 'ok' when the process serves; `warnings` never fail the check. */
@Public()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly workTypes: WorkTypesCheck) {}

  @Get()
  async get(): Promise<Health> {
    return { status: 'ok', warnings: await this.workTypes.warnings() };
  }
}
