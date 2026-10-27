import * as z from 'zod';
import { Id, Timestamp } from './common';
import { Permission, RoleKey } from './roles';

export const SignInEmailBody = z
  .object({
    email: z.email(),
    password: z.string().min(8).max(128),
    rememberMe: z.boolean().optional(),
  })
  .meta({ id: 'SignInEmailBody' });
export type SignInEmailBody = z.infer<typeof SignInEmailBody>;

export const SessionInfo = z
  .object({
    session: z.object({ id: z.string(), expiresAt: Timestamp }),
    user: z.object({ id: z.string(), email: z.email(), name: z.string() }),
  })
  .meta({ id: 'SessionInfo' });
export type SessionInfo = z.infer<typeof SessionInfo>;

export const Me = z
  .object({
    id: Id,
    companyId: Id,
    companyName: z.string(),
    email: z.email(),
    name: z.string(),
    employeeCode: z.string().nullable(),
    roles: z.array(RoleKey),
    permissions: z.array(Permission),
    territoryIds: z.array(Id).meta({ description: 'Territories directly assigned to this user' }),
    managerId: Id.nullable(),
  })
  .meta({ id: 'Me' });
export type Me = z.infer<typeof Me>;

// ---- Forgot password (email OTP, docs/AUTH-PASSWORD-RESET.md) ----

/** 6-digit code, valid 10 minutes, 3 wrong tries then a new code is needed. */
export const PASSWORD_RESET_CODE_LENGTH = 6;
export const PASSWORD_RESET_CODE_TTL_SECONDS = 600;
export const PASSWORD_RESET_MAX_ATTEMPTS = 3;
/** Same rule as invite accept (INVITE_PASSWORD_MIN). */
export const PASSWORD_RESET_MIN = 12;

export const PasswordForgot = z
  .object({ email: z.email().max(254) })
  .meta({ id: 'PasswordForgot' });
export type PasswordForgot = z.infer<typeof PasswordForgot>;

export const PasswordForgotAccepted = z
  .object({
    ok: z.literal(true),
    message: z.string().meta({
      description: 'Always the same text, whether or not the email has an account',
    }),
  })
  .meta({ id: 'PasswordForgotAccepted' });
export type PasswordForgotAccepted = z.infer<typeof PasswordForgotAccepted>;

export const PasswordReset = z
  .object({
    email: z.email().max(254),
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
    password: z
      .string()
      .min(PASSWORD_RESET_MIN, `Password must be at least ${PASSWORD_RESET_MIN} characters`)
      .max(128),
  })
  .meta({ id: 'PasswordReset' });
export type PasswordReset = z.infer<typeof PasswordReset>;

export const PasswordResetDone = z
  .object({ ok: z.literal(true) })
  .meta({ id: 'PasswordResetDone' });
export type PasswordResetDone = z.infer<typeof PasswordResetDone>;

/**
 * Reset failures. All are 400 except TOO_MANY_ATTEMPTS (403). Unknown or ineligible accounts get
 * PASSWORD_RESET_CODE_INVALID, the same as a wrong code (no account enumeration).
 */
export const PASSWORD_RESET_ERROR_CODES = {
  invalid: 'PASSWORD_RESET_CODE_INVALID',
  expired: 'PASSWORD_RESET_CODE_EXPIRED',
  tooMany: 'PASSWORD_RESET_TOO_MANY_ATTEMPTS',
} as const;
