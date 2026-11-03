/**
 * Native sign-in against the AriForce API (better-auth under /v1/auth).
 *
 * Why bearer and not cookies: the API already runs better-auth's bearer() plugin ("bearer tokens
 * for mobile"), and better-auth rejects cookie-carrying POSTs that have no Origin header
 * (403 MISSING_OR_NULL_ORIGIN). A native app sends no Origin, so we never send cookies:
 * every request uses `credentials: 'omit'` (also keeps the OS cookie jar out of it) and
 * `Authorization: Bearer <token>`. This works against the live API with no server change.
 */
import type { AUTH_STATE_CODES, Me, RETIRED_ROLE_KEYS, RoleKey } from '@ariforce/contracts';
import { API_URL, AUTH_ORIGIN, AUTH_URL } from './config';

export type AuthUser = Pick<Me, 'id' | 'name' | 'email' | 'companyName' | 'roles'>;

/**
 * Roles that may use AriForce: every contract role except the retired ones, same rule as the
 * website (apps/web/src/lib/roles.ts isPortalRole). Kept as a type-checked literal instead of a
 * runtime import so the app bundle does not pull zod and the OpenAPI client: `satisfies` fails
 * the typecheck if packages/contracts adds, removes or retires a role.
 */
type PortalRole = Exclude<RoleKey, (typeof RETIRED_ROLE_KEYS)[number]>;
const PORTAL_ROLES = {
  business_manager: true,
  area_business_manager: true,
  regional_business_manager: true,
  zonal_business_manager: true,
  sales_manager: true,
  general_manager: true,
  vice_president: true,
  director: true,
  system_admin: true,
} as const satisfies Record<PortalRole, true>;

export const hasPortalRole = (roles: readonly string[]) =>
  roles.some((r) => Object.hasOwn(PORTAL_ROLES, r));

/** Same words as the website (apps/web/src/lib/mock-auth.ts NO_PORTAL_MESSAGE). */
export const NO_PORTAL_MESSAGE = 'Your role does not have access to this portal.';

type StateCode = (typeof AUTH_STATE_CODES)[keyof typeof AUTH_STATE_CODES];

export type AuthErrorKind =
  | 'credentials'
  | 'account'
  | 'rate-limited'
  | 'origin'
  | 'network'
  | 'server'
  | 'unauthorized'
  | 'no-role'
  | 'otp'
  | 'otp-expired';

export class AuthError extends Error {
  constructor(
    readonly kind: AuthErrorKind,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const TIMEOUT_MS = 12_000;

async function request(url: string, init: RequestInit & { token?: string | null } = {}) {
  const { token, headers, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...rest,
      credentials: 'omit',
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        ...(rest.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new AuthError(
      'network',
      "Can't reach AriForce. Check your internet connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/** better-auth answers `{ code, message }`; our Nest routes answer `{ error: { code, message } }`. */
function errorCode(body: Record<string, unknown> | null): string | undefined {
  if (!body) return undefined;
  if (typeof body.code === 'string') return body.code;
  const e = body.error as { code?: unknown } | undefined;
  return typeof e?.code === 'string' ? e.code : undefined;
}

const ACCOUNT_MESSAGES: Record<StateCode, string | undefined> = {
  ACCOUNT_PENDING_APPROVAL:
    'Your account is waiting for approval. Try again once an admin approves it.',
  ACCOUNT_REJECTED: 'Your sign-up request was not approved. Contact your administrator.',
  ACCOUNT_SUSPENDED: 'This account is suspended. Contact your administrator.',
  ROLE_RETIRED: 'Your role no longer has access to AriForce. Contact your administrator.',
  SIGNUP_UNAVAILABLE: undefined,
  RATE_LIMITED: undefined,
  CAPTCHA_FAILED: undefined,
};

function retryAfterText(res: Response, body: Record<string, unknown> | null) {
  const h = Number(res.headers.get('retry-after'));
  const d = Number(
    (body?.error as { details?: { retryAfterSeconds?: unknown } } | undefined)?.details
      ?.retryAfterSeconds,
  );
  const s = Number.isFinite(h) && h > 0 ? h : Number.isFinite(d) && d > 0 ? d : null;
  return s
    ? `Too many attempts. Try again in ${Math.ceil(s)} seconds.`
    : 'Too many attempts. Try again in a minute.';
}

function toError(res: Response, body: Record<string, unknown> | null): AuthError {
  const code = errorCode(body);
  if (res.status === 429) return new AuthError('rate-limited', retryAfterText(res, body), code);
  if (code && code in ACCOUNT_MESSAGES && ACCOUNT_MESSAGES[code as StateCode])
    return new AuthError('account', ACCOUNT_MESSAGES[code as StateCode]!, code);
  if (code === 'INVALID_ORIGIN' || code === 'MISSING_OR_NULL_ORIGIN')
    return new AuthError(
      'origin',
      'The server refused this app (origin check). Ask the AriForce team to allow the mobile app.',
      code,
    );
  if (res.status === 401 || res.status === 400)
    return new AuthError('credentials', 'Email or password is wrong.', code);
  if (res.status === 403)
    return new AuthError(
      'account',
      'This account cannot use AriForce yet. Contact your administrator.',
      code,
    );
  return new AuthError(
    'server',
    'AriForce could not sign you in right now. Try again in a moment.',
    code,
  );
}

/** Password accepted; a 6-digit code was emailed. `cookie` is the signed challenge to send back. */
export type OtpChallenge = { cookie: string; email: string };

/** The challenge is a cookie set by sign-in; we forward it by hand (the OS cookie jar is off). */
function challengeCookie(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  const m = raw?.match(/((?:__Secure-)?[\w.-]*two_factor)=([^;,\s]+)/);
  return m ? `${m[1]}=${m[2]}` : null;
}

const otpHeaders = (cookie: string) => ({ cookie, origin: AUTH_ORIGIN });

/** POST /v1/auth/two-factor/send-otp: (re)send the sign-in code to the account's email. */
export async function sendLoginOtp(challenge: OtpChallenge): Promise<void> {
  const res = await request(`${AUTH_URL}/two-factor/send-otp`, {
    method: 'POST',
    body: '{}',
    headers: otpHeaders(challenge.cookie),
  });
  if (res.ok) return;
  const body = await readBody(res);
  if (res.status === 429) throw toError(res, body);
  throw new AuthError('otp-expired', 'Your sign-in expired. Enter your password again.');
}

/** POST /v1/auth/sign-in/email. Returns the bearer token, or an OTP challenge when a code is required. */
export async function signInEmail(
  email: string,
  password: string,
): Promise<string | OtpChallenge> {
  const res = await request(`${AUTH_URL}/sign-in/email`, {
    method: 'POST',
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  const body = await readBody(res);
  if (!res.ok) throw toError(res, body);
  if (body?.twoFactorRedirect) {
    const cookie = challengeCookie(res);
    if (!cookie)
      throw new AuthError('server', 'Could not start the email code step. Try again.');
    const challenge = { cookie, email };
    await sendLoginOtp(challenge);
    return challenge;
  }
  // bearer() puts the signed session token in `set-auth-token`; the body token also works.
  const token =
    res.headers.get('set-auth-token') ?? (typeof body?.token === 'string' ? body.token : null);
  if (!token)
    throw new AuthError('server', 'Signed in, but the server sent no session token. Try again.');
  return token;
}

/** POST /v1/auth/two-factor/verify-otp: the emailed code. Returns the bearer token. */
export async function verifyLoginOtp(challenge: OtpChallenge, code: string): Promise<string> {
  const res = await request(`${AUTH_URL}/two-factor/verify-otp`, {
    method: 'POST',
    body: JSON.stringify({ code }),
    headers: otpHeaders(challenge.cookie),
  });
  const body = await readBody(res);
  if (!res.ok) {
    if (res.status === 429) throw toError(res, body);
    const c = errorCode(body);
    if (c === 'INVALID_TWO_FACTOR_COOKIE')
      throw new AuthError('otp-expired', 'Your sign-in expired. Enter your password again.', c);
    if (c === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' || c === 'OTP_HAS_EXPIRED')
      throw new AuthError('otp', 'That code is no longer valid. Ask for a new one.', c);
    if (c === 'ACCOUNT_TEMPORARILY_LOCKED')
      throw new AuthError('otp', 'Too many wrong codes. Try again later.', c);
    throw new AuthError('otp', 'That code is not right. Check it and try again.', c);
  }
  const token =
    res.headers.get('set-auth-token') ?? (typeof body?.token === 'string' ? body.token : null);
  if (!token)
    throw new AuthError('server', 'Signed in, but the server sent no session token. Try again.');
  return token;
}

/** GET /v1/me: the signed-in AriForce user (name, company, roles). */
export async function fetchMe(token: string): Promise<AuthUser> {
  const res = await request(`${API_URL}/v1/me`, { token });
  const body = await readBody(res);
  if (res.status === 401)
    throw new AuthError('unauthorized', 'Your session has ended. Sign in again.');
  if (!res.ok) throw toError(res, body);
  const me = body as unknown as Me;
  if (!hasPortalRole(me.roles ?? []))
    throw new AuthError('no-role', NO_PORTAL_MESSAGE, 'NO_PORTAL_ROLE');
  return {
    id: me.id,
    name: me.name,
    email: me.email,
    companyName: me.companyName,
    roles: me.roles,
  };
}

/** POST /v1/auth/sign-out. Best effort: the local token is dropped either way. */
export async function signOutRemote(token: string): Promise<void> {
  try {
    await request(`${AUTH_URL}/sign-out`, { method: 'POST', token, body: '{}' });
  } catch {
    // Offline sign-out still clears the device; the server session expires on its own.
  }
}
