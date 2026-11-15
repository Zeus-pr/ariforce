import { Controller, Get, Query } from '@nestjs/common';
import { AuditLogQuery } from '@ariforce/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ZodPipe } from '../common/zod.pipe';
import { AuditLogService } from './audit-log.service';

/** GET /v1/audit-log (#128): Director and System Admin (audit:read). */
@Controller({ path: 'audit-log', version: '1' })
export class AuditLogController {
  constructor(private readonly svc: AuditLogService) {}

  @Get()
  @RequirePermissions('audit:read')
  list(@CurrentPrincipal() p: Principal, @Query(new ZodPipe(AuditLogQuery)) q: AuditLogQuery) {
    return this.svc.list(p, q);
  }
}
