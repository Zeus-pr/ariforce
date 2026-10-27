import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@ariforce/db';
import { DB } from '../db/db.module';
import { AuditService } from '../common/audit.service';
import { MailService } from '../mail/mail.service';
import { createAuth, type Auth } from './auth';

@Injectable()
export class AuthService {
  readonly auth: Auth;
  constructor(
    @Inject(DB) db: Db,
    readonly audit: AuditService,
    mail: MailService,
  ) {
    this.auth = createAuth(db, audit, mail);
  }
}
