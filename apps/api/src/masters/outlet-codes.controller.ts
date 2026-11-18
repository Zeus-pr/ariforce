import { Controller, Get, Query } from '@nestjs/common';
import { masterReadPermission, OutletCodeQuery } from '@ariforce/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { TenantService } from '../common/tenant.service';
import { ZodPipe } from '../common/zod.pipe';
import { previewOutletCode } from './outlet-code';

/** Next Arighna code for a doctor, chemist, or stockist. Does not reserve it. */
@Controller({ path: 'outlet-codes', version: '1' })
export class OutletCodesController {
  constructor(private readonly tenant: TenantService) {}

  @Get('next')
  @RequirePermissions(masterReadPermission('doctors'))
  next(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(OutletCodeQuery)) q: OutletCodeQuery) {
    return this.tenant.run(p, async (tx) => ({
      code: await previewOutletCode(tx, p.companyId, q.kind),
    }));
  }
}
