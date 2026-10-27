/**
 * Forgot password by email code. The only file that knows the endpoints (assumed contract, see
 * docs/CONTRACT-GAPS.md): better-auth email-OTP routes under /v1/auth.
 *   POST /v1/auth/email-otp/send-verification-otp { email, type: 'forget-password' } -> 200 (always, even for unknown emails)
 *   POST /v1/auth/email-otp/reset-password { email, otp, password } -> 200; all sessions revoked
 * Errors: INVALID_OTP, OTP_EXPIRED, TOO_MANY_ATTEMPTS, PASSWORD_TOO_SHORT / VALIDATION, 429 RATE_LIMITED.
 * Codes and passwords are never stored or logged.
 */
import { API_URL, apiReady } from '@/lib/api';
import { INVITE_PASSWORD_MIN } from '@ariforce/contracts';

export const RESET_PASSWORD_MIN = INVITE_PASSWORD_MIN;
export const CODE_LENGTH = 6;
export const RESEND_SECONDS = 30;

export type ResetFailure =
  | { kind: 'wrong' }
  | { kind: 'expired' }
  | { kind: 'attempts' }
  | { kind: 'busy'; seconds: number | null }
  | { kind: 'invalid'; message: string }
  | { kind: 'other' };

async function post(path: string, body: unknown): Promise<{ ok: true } | ResetFailure> {
  await apiReady();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'other' };
  }
  if (res.ok) return { ok: true };
  const j = (await res.json().catch(() => null)) as {
    code?: string;
    message?: string;
    error?: { code?: string; message?: string };
  } | null;
  // better-auth sends { code, message }; the API envelope is { error: { code, message } }. Accept both.
  const code = j?.error?.code ?? j?.code ?? '';
  const message = j?.error?.message ?? j?.message ?? '';
  if (res.status === 429 || code === 'RATE_LIMITED') {
    const h = Number(res.headers.get('Retry-After'));
    return { kind: 'busy', seconds: Number.isFinite(h) && h > 0 ? Math.ceil(h) : null };
  }
  if (code === 'TOO_MANY_ATTEMPTS') return { kind: 'attempts' };
  if (code === 'OTP_EXPIRED') return { kind: 'expired' };
  if (code === 'INVALID_OTP') return { kind: 'wrong' };
  if (res.status === 400 || res.status === 422) return { kind: 'invalid', message };
  return { kind: 'other' };
}

export const sendResetCode = (email: string) =>
  post('email-otp/send-verification-otp', {
    email: email.trim().toLowerCase(),
    type: 'forget-password',
  });

export const resetPassword = (email: string, otp: string, password: string) =>
  post('email-otp/reset-password', { email: email.trim().toLowerCase(), otp, password });
