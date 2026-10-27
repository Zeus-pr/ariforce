import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { bearer, emailOTP } from 'better-auth/plugins';
import { eq, sql } from 'drizzle-orm';
import {
  AUTH_STATE_CODES,
  PASSWORD_RESET_CODE_LENGTH,
  PASSWORD_RESET_CODE_TTL_SECONDS,
  PASSWORD_RESET_MAX_ATTEMPTS,
  isRetiredRole,
} from '@ariforce/contracts';
import {
  authAccount,
  authSession,
  authUser,
  authVerification,
  roles,
  userRoles,
  withTenant,
  type Db,
} from '@ariforce/db';
import type { AuditService } from '../common/audit.service';
import { CLIENT_IP_HEADER } from '../common/client-ip';
import type { MailService } from '../mail/mail.service';

export const AUTH_BASE_PATH = '/v1/auth';
/** Browser origins allowed for CORS (with credentials) and better-auth: WEB_ORIGIN, comma-separated. */
export const webOrigins = () =>
  (process.env.WEB_ORIGIN ?? 'http://localhost:3000,http://localhost:3200')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

/**
 * better-auth: email + password, DB sessions (revocable), bearer tokens for mobile.
 * better-auth sign-up is disabled: identities come from admins/seed/invites or POST
 * /v1/auth/sign-up-request (pending until approved; see docs/RBAC.md).
 */
export function createAuth(db: Db, audit: AuditService, mail?: MailService) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === 'production')
    throw new Error('BETTER_AUTH_SECRET is required');
  return betterAuth({
    appName: 'AriForce',
    basePath: AUTH_BASE_PATH,
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:4000',
    secret: secret ?? 'dev-only-insecure-secret-change-me-0000000000',
    trustedOrigins: webOrigins(),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      // Forgot password (email OTP) signs out every device (#79).
      revokeSessionsOnPasswordReset: true,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    plugins: [
      bearer(),
      // Forgot password only (docs/AUTH-PASSWORD-RESET.md). The plugin's own routes are not
      // reachable over HTTP (bootstrap blocks them); POST /v1/auth/password/* calls auth.api.
      emailOTP({
        otpLength: PASSWORD_RESET_CODE_LENGTH,
        expiresIn: PASSWORD_RESET_CODE_TTL_SECONDS,
        allowedAttempts: PASSWORD_RESET_MAX_ATTEMPTS,
        storeOTP: 'hashed',
        disableSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== 'forget-password' || !mail) return;
          // Not awaited: the answer time must not reveal whether an email went out.
          void mail.passwordResetCode(email, otp, PASSWORD_RESET_CODE_TTL_SECONDS / 60);
        },
      }),
    ],
    telemetry: { enabled: false },
    // Only our own header (set in bootstrap from the trusted client IP; client values overwritten).
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    databaseHooks: {
      session: {
        create: {
          // Runs after the password check: pending/rejected sign-ups get a clear state, no session.
          before: async (session) => {
            const r = await db.execute<{ s: string | null }>(
              sql`select auth_account_status(${session.userId}) as s`,
            );
            const st = r.rows[0]?.s;
            if (st === 'pending')
              throw new APIError('FORBIDDEN', {
                code: AUTH_STATE_CODES.pending,
                message: 'Your account is awaiting approval',
              });
            if (st === 'rejected')
              throw new APIError('FORBIDDEN', {
                code: AUTH_STATE_CODES.rejected,
                message: 'Your sign-up request was not approved',
              });
            // Deactivated (suspended) users cannot start a new session (#79).
            if (st === 'suspended')
              throw new APIError('FORBIDDEN', {
                code: AUTH_STATE_CODES.suspended,
                message: 'Your account is deactivated',
              });
            // Holders of only retired roles (distribution_head / accountant) get no session.
            const m = await audit.resolveMembership(session.userId);
            if (m) {
              const held = await withTenant(db, m, (tx) =>
                tx
                  .select({ key: roles.key })
                  .from(userRoles)
                  .innerJoin(roles, eq(roles.id, userRoles.roleId))
                  .where(eq(userRoles.userId, m.userId)),
              );
              if (held.length && held.every((x) => isRetiredRole(x.key)))
                throw new APIError('FORBIDDEN', {
                  code: AUTH_STATE_CODES.retired,
                  message: 'Your role is no longer in use; contact your administrator',
                });
            }
          },
          after: async (session) => {
            await audit.recordForAuthUser(session.userId, 'auth.sign_in', {
              entityType: 'session',
              entityId: session.id,
              ip: session.ipAddress ?? null,
              userAgent: session.userAgent ?? null,
            });
          },
        },
        delete: {
          after: async (session, ctx) => {
            await audit.recordForAuthUser(
              session.userId,
              ctx?.path === '/sign-out' ? 'auth.sign_out' : 'auth.session_revoked',
              { entityType: 'session', entityId: session.id },
            );
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
