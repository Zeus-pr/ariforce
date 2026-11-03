import { ipRateKey } from '../common/client-ip';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { APIError } from 'better-auth/api';
import {
  PASSWORD_RESET_ERROR_CODES as CODES,
  isRetiredRole,
  type PasswordForgot,
  type PasswordForgotAccepted,
  type PasswordReset,
  type PasswordResetDone,
} from '@ariforce/contracts';
import { authUser, roles, userRoles, withTenant, type Db } from '@ariforce/db';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import { AuditService } from '../common/audit.service';
import { LIMITS, enforce } from '../common/rate-limit';
import { AuthService } from './auth.service';

export const FORGOT_MESSAGE =
  'If an active account uses this email, a 6-digit code is on its way. It expires in 10 minutes.';

const fail = (status: number, code: string, message: string) =>
  new HttpException({ code, message }, status);

/**
 * Forgot password with an emailed 6-digit code (better-auth emailOTP, type forget-password).
 * docs/AUTH-PASSWORD-RESET.md. The answer to "forgot" never reveals whether an account exists.
 */
@Injectable()
export class PasswordResetService {
  private readonly log = new Logger('PasswordReset');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Eligible = an auth identity exists, the employee is `active` (not suspended, pending,
   * rejected or invited-never-accepted) and holds at least one non-retired role.
   */
  private async eligible(email: string): Promise<string | null> {
    const [a] = await this.db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, email));
    if (!a) return null;
    const st = await this.db.execute<{ s: string | null }>(
      sql`select auth_account_status(${a.id}) as s`,
    );
    if (st.rows[0]?.s !== 'active') return null;
    const m = await this.audit.resolveMembership(a.id);
    if (!m) return null;
    const held = await withTenant(this.db, m, (tx) =>
      tx
        .select({ key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, m.userId)),
    );
    if (held.length && held.every((x) => isRetiredRole(x.key))) return null;
    return a.id;
  }

  async forgot(b: PasswordForgot, ip: string | null): Promise<PasswordForgotAccepted> {
    const email = b.email.trim().toLowerCase();
    const emailKey = createHash('sha256').update(email).digest('hex').slice(0, 32);
    await enforce([
      { key: `pwreset-forgot:ip:${ipRateKey(ip)}`, ...LIMITS.passwordForgotIp() },
      { key: `pwreset-forgot:email:${emailKey}`, ...LIMITS.passwordForgotEmail() },
    ]);
    const id = await this.eligible(email);
    if (id) {
      try {
        await this.authService.auth.api.requestPasswordResetEmailOTP({ body: { email } });
        await this.audit.recordForAuthUser(id, 'auth.password_reset_requested', {
          entityType: 'auth_user',
          entityId: id,
          ip,
        });
      } catch (e) {
        this.log.error(`forgot failed: ${(e as Error).message}`);
      }
    }
    return { ok: true, message: FORGOT_MESSAGE };
  }

  async reset(b: PasswordReset, ip: string | null): Promise<PasswordResetDone> {
    await enforce([{ key: `pwreset-reset:ip:${ipRateKey(ip)}`, ...LIMITS.passwordResetIp() }]);
    const email = b.email.trim().toLowerCase();
    const id = await this.eligible(email);
    if (!id) throw fail(400, CODES.invalid, 'The code is not valid');
    // better-auth answers an expired code with INVALID_OTP; tell the user it expired instead.
    const ident = `forget-password-otp-${email}`;
    const exp = await this.db.execute<{ expired: boolean }>(
      sql`select expires_at < now() as expired from auth_verification where identifier = ${ident}
          order by created_at desc limit 1`,
    );
    if (exp.rows[0]?.expired) {
      await this.db.execute(sql`delete from auth_verification where identifier = ${ident}`);
      throw fail(400, CODES.expired, 'The code has expired; ask for a new one');
    }
    try {
      await this.authService.auth.api.resetPasswordEmailOTP({
        body: { email, otp: b.code, password: b.password },
      });
    } catch (e) {
      if (e instanceof APIError) {
        const code = (e.body as { code?: string } | undefined)?.code;
        if (code === 'OTP_EXPIRED')
          throw fail(400, CODES.expired, 'The code has expired; ask for a new one');
        if (code === 'TOO_MANY_ATTEMPTS')
          throw fail(403, CODES.tooMany, 'Too many wrong codes; ask for a new one');
        if (code === 'INVALID_OTP' || code === 'USER_NOT_FOUND')
          throw fail(400, CODES.invalid, 'The code is not valid');
      }
      throw e;
    }
    await this.audit.recordForAuthUser(id, 'auth.password_reset_completed', {
      entityType: 'auth_user',
      entityId: id,
      ip,
    });
    return { ok: true };
  }
}
