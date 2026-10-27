import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditService } from '../common/audit.service';
import { ErrorFilter } from '../common/error.filter';
import { TenantService } from '../common/tenant.service';
import { MAIL_SENDER, MailService, mailSenderFromEnv } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { SessionGuard } from './session.guard';

@Global()
@Module({
  controllers: [PasswordResetController],
  providers: [
    { provide: MAIL_SENDER, useFactory: mailSenderFromEnv },
    MailService,
    PasswordResetService,
    AuditService,
    TenantService,
    AuthService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
  exports: [AuditService, TenantService, AuthService, MailService],
})
export class AuthModule {}
