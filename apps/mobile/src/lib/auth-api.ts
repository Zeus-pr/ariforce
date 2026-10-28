/**
 * Native sign-in against the AriForce API (better-auth under /v1/auth).
 *
 * Why bearer and not cookies: the API already runs better-auth's bearer() plugin ("bearer tokens
 * for mobile"), and better-auth rejects cookie-carrying POSTs that have no Origin header
 * (403 MISSING_OR_NULL_ORIGIN). A native app sends no Origin, so we never send cookies:
 * every request uses `credentials: 'omit'` (also keeps the OS cookie jar out of it) and
 * `Authorization: Bearer <token>`. This works against the live API with no server change.
 */
import type { AUTH_STATE_CODES, Me } from '@ariforce/contracts';
import { API_URL, AUTH_URL } from './config';

export type AuthUser = Pick<Me, 'id' | 'name' | 'email' | 'companyName' | 'roles'>;

type StateCode = (typeof AUTH_STATE_CODES)[keyof typeof AUTH_STATE_CODES];

export type AuthErrorKind =
  'credentials' | 'account' | 'rate-limited' | 'origin' | 'network' | 'server' | 'unauthorized';

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

/** POST /v1/auth/sign-in/email. Returns the bearer token for later requests. */
export async function signInEmail(email: string, password: string): Promise<string> {
  const res = await request(`${AUTH_URL}/sign-in/email`, {
    method: 'POST',
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  const body = await readBody(res);
  if (!res.ok) throw toError(res, body);
  // bearer() puts the signed session token in `set-auth-token`; the body token also works.
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
