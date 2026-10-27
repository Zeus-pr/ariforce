/**
 * Shared messages for auth-like endpoints (sign-in, sign-up, invite accept): 429 RATE_LIMITED and
 * 403 ACCOUNT_SUSPENDED. Wait time comes from the Retry-After header, else details.retryAfterSeconds.
 */
import { toApiError } from '@/lib/api';

export const SUSPENDED_MESSAGE = 'This account is suspended. Contact your administrator.';

type Result = { response?: Response; error?: unknown } | null | undefined;

export function retryAfterSeconds(r: Result): number | null {
  const h = r?.response?.headers.get('Retry-After');
  if (h) {
    const n = Number(h);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
    const at = Date.parse(h);
    if (!Number.isNaN(at)) return Math.max(1, Math.ceil((at - Date.now()) / 1000));
  }
  const d = r ? (toApiError(r).details as { retryAfterSeconds?: unknown } | undefined) : undefined;
  const v = Number(d?.retryAfterSeconds);
  return Number.isFinite(v) && v > 0 ? Math.ceil(v) : null;
}

export function rateLimitMessage(r: Result) {
  const s = retryAfterSeconds(r);
  return s ? `Too many attempts, try again in ${s} ${s === 1 ? 'second' : 'seconds'}.` : 'Too many attempts, try again in a minute.';
}

/** Message for 429/403-suspended, or null when the response is neither. */
export function authLimitMessage(r: Result): string | null {
  if (!r) return null;
  const code = toApiError(r).code;
  if (r.response?.status === 429 || code === 'RATE_LIMITED') return rateLimitMessage(r);
  if (code === 'ACCOUNT_SUSPENDED') return SUSPENDED_MESSAGE;
  return null;
}
