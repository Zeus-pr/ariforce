import { assignMessage } from './assign-errors';
import { createApiClient } from '@ariforce/contracts';

/**
 * THE switch between the contract mocks and the real API (docs/WEB-ENV.md):
 * NEXT_PUBLIC_API_MODE=real (production-only)
 */
export const API_MODE: 'real' = 'real';
export const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';
export const API_BASE_URL = API_URL;
export const MOCKING = false;
export const REAL = true;

/** Typed client for the AriForce API. See docs/API-CONVENTIONS.md. Sends the session cookie (credentials: 'include'). */
export const api = createApiClient(API_URL);

/** Called on any 401 in real mode (set by lib/mock-auth so this module has no auth dependency). */
let onUnauthenticated: (() => void) | null = null;
/** Called when a data call says the account is pending approval or rejected (docs/SIGNUP.md §2). */
export type AccountState = 'pending' | 'rejected' | 'suspended';
let onAccountState: ((state: AccountState) => void) | null = null;
export const setAccountStateHandler = (fn: (state: AccountState) => void) => {
  onAccountState = fn;
};
export const setUnauthenticatedHandler = (fn: () => void) => {
  onUnauthenticated = fn;
};
api.use({
  // A hung or unreachable API must end in an error state, never an endless spinner.
  onRequest({ request }) {
    // Production only: no mock-specific headers needed
    if (!REAL || request.signal?.aborted) return request;
    // Keep the caller's abort (stale-search cancellation) and add the timeout.
    const timeout = AbortSignal.timeout(8000);
    const signal =
      request.signal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([request.signal, timeout])
        : timeout;
    return new Request(request, { signal });
  },
  onResponse({ response, request }) {
    if (REAL && response.status === 401 && !new URL(request.url).pathname.startsWith('/v1/auth/'))
      onUnauthenticated?.();
    if (response.status === 403 && !new URL(request.url).pathname.startsWith('/v1/auth/'))
      void response
        .clone()
        .json()
        .then((b: { error?: { code?: string } }) => {
          const c = b?.error?.code;
          if (c === 'ACCOUNT_PENDING_APPROVAL') onAccountState?.('pending');
          else if (c === 'ACCOUNT_REJECTED') onAccountState?.('rejected');
          else if (c === 'ACCOUNT_SUSPENDED') onAccountState?.('suspended');
        })
        .catch(() => {});
    return response;
  },
});

/**
 * Resolves once the API can be called. In production, there's no setup needed.
 */
export function apiReady(): Promise<void> {
  return Promise.resolve();
}

export type ApiError = { code: string; message: string; details?: unknown };

/**
 * Accepts either the response body (`{ error: ApiError }`) or the whole openapi-fetch result
 * (`{ error: { error: ApiError }, response }`); both shapes are used across the app.
 */
export function toApiError(error: unknown): ApiError {
  let e = (error as { error?: unknown } | undefined)?.error;
  const inner = (e as { error?: unknown } | undefined)?.error;
  if (inner && typeof inner === 'object' && 'code' in inner) e = inner;
  const a = e as Partial<ApiError> | undefined;
  if (a?.code === 'REJECTION_REASON_REQUIRED') return { code: a.code, message: 'Give a reason to reject this request.', details: a.details };
  const assign = assignMessage(a);
  if (a?.code && assign) return { code: a.code, message: assign, details: a.details };
  if (a?.code === 'DAY_LOCKED') return { code: a.code, message: 'Some days are already submitted or approved and can’t be changed.', details: a.details };
  return a?.code ? { code: a.code, message: a.message ?? '', details: a.details } : { code: 'NETWORK', message: 'Could not reach the server.' };
}
