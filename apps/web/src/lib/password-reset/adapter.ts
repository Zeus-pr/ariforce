/**
 * Forgot password by email code. The only file that knows the endpoints (docs/AUTH-PASSWORD-RESET.md):
 *   POST /v1/auth/password/forgot { email } -> 200 { ok, message } (always the same answer)
 *   POST /v1/auth/password/reset { email, code, password (12-128) } -> 200 { ok }; all sessions revoked
 * Errors: 400 PASSWORD_RESET_CODE_INVALID / PASSWORD_RESET_CODE_EXPIRED, 403 PASSWORD_RESET_TOO_MANY_ATTEMPTS,
 * 422 VALIDATION, 429 RATE_LIMITED (Retry-After). The code is valid for 10 minutes.
 * Codes and passwords are never stored or logged.
 */
import { API_URL, apiReady } from '@/lib/api';
import { INVITE_PASSWORD_MIN } from '@ariforce/contracts';

export const RESET_PASSWORD_MIN = INVITE_PASSWORD_MIN;
export const RESET_PASSWORD_MAX = 128;
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
  const code = j?.error?.code ?? j?.code ?? '';
  const message = j?.error?.message ?? j?.message ?? '';
  if (res.status === 429 || code === 'RATE_LIMITED') {
    const h = Number(res.headers.get('Retry-After'));
    return { kind: 'busy', seconds: Number.isFinite(h) && h > 0 ? Math.ceil(h) : null };
  }
  if (code === 'PASSWORD_RESET_TOO_MANY_ATTEMPTS' || res.status === 403)
    return { kind: 'attempts' };
  if (code === 'PASSWORD_RESET_CODE_EXPIRED') return { kind: 'expired' };
  if (code === 'PASSWORD_RESET_CODE_INVALID') return { kind: 'wrong' };
  if (res.status === 400 || res.status === 422) return { kind: 'invalid', message };
  return { kind: 'other' };
}

export const sendResetCode = (email: string) =>
  post('password/forgot', { email: email.trim().toLowerCase() });

export const resetPassword = (email: string, otp: string, password: string) =>
  post('password/reset', { email: email.trim().toLowerCase(), code: otp, password });
