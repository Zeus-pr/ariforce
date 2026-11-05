import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { bearer, emailOTP, twoFactor } from 'better-auth/plugins';
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
  authTwoFactor,
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
/** Web (browser cookie) hard cap from sign-in. Also sets cookie Max-Age. Default 18 h. */
export const SESSION_MAX_AGE_DEFAULT_S = 18 * 60 * 60;
/** Mobile (Expo / bearer) hard cap from sign-in. Default 90 days — no 18 h forced re-login. */
export const MOBILE_SESSION_MAX_AGE_DEFAULT_S = 90 * 24 * 60 * 60;
export const CLIENT_HEADER = 'x-ariforce-client';

export const sessionMaxAgeSeconds = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.SESSION_MAX_AGE_SECONDS);
  return Number.isInteger(n) && n >= 300 && n <= 30 * 24 * 60 * 60 ? n : SESSION_MAX_AGE_DEFAULT_S;
};
export const mobileSessionMaxAgeSeconds = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.MOBILE_SESSION_MAX_AGE_SECONDS);
  return Number.isInteger(n) && n >= 300 && n <= 365 * 24 * 60 * 60
    ? n
    : MOBILE_SESSION_MAX_AGE_DEFAULT_S;
};

/** Mobile app sends `x-ariforce-client: mobile`; Expo/RN UAs often include Expo or okhttp. */
export function isMobileAuthClient(
  userAgent: string | null | undefined,
  clientHeader?: string | null,
) {
  if ((clientHeader ?? '').trim().toLowerCase() === 'mobile') return true;
  const ua = userAgent ?? '';
  return /\bExpo\b/i.test(ua) || /\bokhttp\b/i.test(ua);
}

function headerGet(
  ctx: { headers?: Headers; request?: { headers?: Headers } } | null | undefined,
  name: string,
) {
  const h = ctx?.headers ?? ctx?.request?.headers;
  if (!h || typeof h.get !== 'function') return null;
  return h.get(name);
}
/**
 * Session cookie attributes: HttpOnly, Path=/, Secure on https (better-auth defaults). SameSite from
 * AUTH_COOKIE_SAMESITE (lax default; none = cross-site web/API hosts, always Secure). AUTH_COOKIE_DOMAIN
 * (e.g. x.com) shares the cookie across app.x.com / api.x.com.
 */
export function authCookieOptions(env: NodeJS.ProcessEnv = process.env) {
  const raw = (env.AUTH_COOKIE_SAMESITE ?? '').trim().toLowerCase();
  const sameSite = raw === 'none' || raw === 'strict' ? raw : 'lax';
  const domain = (env.AUTH_COOKIE_DOMAIN ?? '').trim();
  return {
    defaultCookieAttributes: {
      httpOnly: true,
      path: '/',
      sameSite,
      ...(sameSite === 'none' ? { secure: true } : {}),
    },
    ...(domain ? { crossSubDomainCookies: { enabled: true, domain } } : {}),
  } as const;
}
export const LOGIN_OTP_LENGTH = 6;
export const LOGIN_OTP_TTL_MINUTES = 5;
export const LOGIN_OTP_MAX_ATTEMPTS = 3;
/** Emailed sign-in code after the password. Off unless LOGIN_OTP is 1/true/on (rollout switch). */
export const loginOtpEnabled = () =>
  ['1', 'true', 'on'].includes((process.env.LOGIN_OTP ?? '').trim().toLowerCase());
/** Browser origins allowed for CORS (with credentials) and better-auth: WEB_ORIGIN, comma-separated. */
export const webOrigins = () =>
  (process.env.WEB_ORIGIN ?? 'http://localhost:3000,http://localhost:3100,http://localhost:3200')
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
        twoFactor: authTwoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      // Forgot password (email OTP) signs out every device (#79).
      revokeSessionsOnPasswordReset: true,
    },
    // Web cookie Max-Age = expiresIn (18 h). updateAge = expiresIn → no sliding for anyone.
    // Mobile bearer rows get a longer expiresAt in session.create.before (see isMobileAuthClient).
    // No cookieCache: revocation stays immediate.
    session: { expiresIn: sessionMaxAgeSeconds(), updateAge: sessionMaxAgeSeconds() },
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
      // Second step after the password: a 6-digit code by email (docs/AUTH-LOGIN-OTP.md). The
      // password check creates no usable session; /two-factor/verify-otp issues it. Email OTP only:
      // TOTP and backup codes are off and their routes are blocked in bootstrap.
      ...(loginOtpEnabled()
        ? [
            twoFactor({
              issuer: 'AriForce',
              twoFactorTable: 'twoFactor',
              totpOptions: { disable: true },
              twoFactorCookieMaxAge: 10 * 60,
              otpOptions: {
                digits: LOGIN_OTP_LENGTH,
                period: LOGIN_OTP_TTL_MINUTES,
                allowedAttempts: LOGIN_OTP_MAX_ATTEMPTS,
                storeOTP: 'hashed',
                sendOTP: async ({ user, otp }) => {
                  if (!mail) return;
                  void mail.loginCode(user.email, otp, LOGIN_OTP_TTL_MINUTES);
                },
              },
            }),
          ]
        : []),
    ],
    telemetry: { enabled: false },
    // Only our own header (set in bootstrap from the trusted client IP; client values overwritten).
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] }, ...authCookieOptions() },
    databaseHooks: {
      session: {
        create: {
          // Runs after the password check: pending/rejected sign-ups get a clear state, no session.
          before: async (session, ctx) => {
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
            // Web keeps the 18 h row; mobile bearer gets a longer hard cap (still revoked on
            // password reset / deactivate / role change).
            if (isMobileAuthClient(session.userAgent, headerGet(ctx, CLIENT_HEADER))) {
              return {
                data: {
                  expiresAt: new Date(Date.now() + mobileSessionMaxAgeSeconds() * 1000),
                },
              };
            }
          },
          after: async (session, ctx) => {
            // The password-only session is deleted at once when an OTP step follows; the real
            // sign-in is recorded when /two-factor/verify-otp creates the session.
            if (loginOtpEnabled() && ctx?.path === '/sign-in/email') return;
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
            if (loginOtpEnabled() && ctx?.path === '/sign-in/email') return;
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
