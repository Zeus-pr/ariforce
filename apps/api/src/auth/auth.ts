import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { sql } from 'drizzle-orm';
import { AUTH_STATE_CODES } from '@ariforce/contracts';
import { authAccount, authSession, authUser, authVerification, type Db } from '@ariforce/db';
import type { AuditService } from '../common/audit.service';

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
export function createAuth(db: Db, audit: AuditService) {
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
      // If a reset flow is enabled later, a reset signs out every device (#79).
      revokeSessionsOnPasswordReset: true,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    plugins: [bearer()],
    telemetry: { enabled: false },
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
