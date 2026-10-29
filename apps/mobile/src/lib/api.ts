/**
 * Authenticated JSON calls to the AriForce API for feature screens. Same transport as sign-in
 * (lib/auth-api.ts): bearer token from SecureStore, `credentials: 'omit'`, no cookies.
 * Nest routes answer errors as `{ error: { code, message, details } }`.
 */
import { AuthError } from './auth-api';
import { API_URL } from './config';
import { tokenStore } from './token-store';

const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export async function apiFetch<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    query?: Query;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const token = await tokenStore.getToken().catch(() => null);
  if (!token) throw new AuthError('unauthorized', 'Your session has ended. Sign in again.');
  const qs = Object.entries(init.query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  init.signal?.addEventListener('abort', () => ctrl.abort());
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs ? `?${qs}` : ''}`, {
      method: init.method ?? 'GET',
      credentials: 'omit',
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach AriForce. Check your internet connection.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 401)
    throw new AuthError('unauthorized', 'Your session has ended. Sign in again.');
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      e?.code,
      e?.message ??
        (res.status === 403
          ? 'You do not have permission to do this.'
          : 'Something went wrong. Try again.'),
      e?.details,
    );
  }
  return body as T;
}

/** RFC 4122 v4-style key for Idempotency-Key headers (no crypto module needed). */
export function idempotencyKey() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
