import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditService } from '../common/audit.service';
import { ErrorFilter } from '../common/error.filter';
import { TenantService } from '../common/tenant.service';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';

@Global()
@Module({
  providers: [
    AuditService,
    TenantService,
    AuthService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
  exports: [AuditService, TenantService, AuthService],
})
export class AuthModule {}
