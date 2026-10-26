import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@ariforce/db';
import { DB } from '../db/db.module';
import { AuditService } from '../common/audit.service';
import { createAuth, type Auth } from './auth';

@Injectable()
export class AuthService {
  readonly auth: Auth;
  constructor(
    @Inject(DB) db: Db,
    readonly audit: AuditService,
  ) {
    this.auth = createAuth(db, audit);
  }
}
