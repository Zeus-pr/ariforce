import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DoctorDuplicateCheck, masterReadPermission } from '@ariforce/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { DoctorsService } from './doctors.service';

/** Duplicate pre-check for the add-doctor form (#26). */
@Controller({ path: 'doctors', version: '1' })
export class DoctorsController {
  constructor(private readonly svc: DoctorsService) {}

  @Post('duplicate-check')
  @HttpCode(200)
  @RequirePermissions(masterReadPermission('doctors'))
  check(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(DoctorDuplicateCheck)) b: DoctorDuplicateCheck,
  ) {
    return this.svc.check(p, b);
  }
}
