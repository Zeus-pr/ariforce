import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { authAccount, authSession, authUser, authVerification, type Db } from '@ariforce/db';
import type { AuditService } from '../common/audit.service';

export const AUTH_BASE_PATH = '/v1/auth';

/**
 * better-auth: email + password, DB sessions (revocable), bearer tokens for mobile.
 * Sign-up is disabled: identities are provisioned by admins/seed and linked to a tenant user.
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
    trustedOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
      },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    plugins: [bearer()],
    telemetry: { enabled: false },
    databaseHooks: {
      session: {
        create: {
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
