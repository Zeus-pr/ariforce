import { createApiClient } from '@ariforce/contracts';

/**
 * THE switch between the contract mocks and the real API (docs/WEB-ENV.md):
 * NEXT_PUBLIC_API_MODE=mock|real (default mock), NEXT_PUBLIC_API_BASE_URL for the real API.
 * The older NEXT_PUBLIC_API_URL / NEXT_PUBLIC_API_MOCKING names are still read as fallbacks.
 */
export const API_MODE: 'mock' | 'real' =
  process.env.NEXT_PUBLIC_API_MODE === 'real' ||
  (!process.env.NEXT_PUBLIC_API_MODE && process.env.NEXT_PUBLIC_API_MOCKING === 'disabled')
    ? 'real'
    : 'mock';
export const API_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';
export const API_BASE_URL = API_URL;
export const MOCKING = API_MODE === 'mock';
export const REAL = API_MODE === 'real';

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
    // Mock mode: the expense (#52) and leave (#51) mocks decide by principal, so tell them who is
    // signed in (the other mocks still act as the default persona). Never sent in real mode.
    if (
      MOCKING &&
      typeof window !== 'undefined' &&
      /^\/v1\/(expense|leave\/|team\/members\/|exception|notifications|admin\/|allowance)/.test(new URL(request.url).pathname)
    ) {
      try {
        const s = JSON.parse(localStorage.getItem('af:mock-session') ?? 'null') as {
          role?: string;
          previewRole?: string;
        } | null;
        const who = s?.previewRole ?? s?.role;
        if (who) {
          const headers = new Headers(request.headers);
          headers.set('x-mock-user', who);
          return new Request(request, { headers });
        }
      } catch {
        // storage blocked: default persona
      }
    }
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

let readyPromise: Promise<void> | null = null;

/**
 * Resolves once the API can be called. In mock mode this starts the MSW worker built from
 * `@ariforce/contracts/mocks`, so every response is validated against the contract. If the worker
 * cannot start (e.g. service workers blocked) requests simply go to the network.
 */
export function apiReady(): Promise<void> {
  if (typeof window === 'undefined' || !MOCKING) return Promise.resolve();
  readyPromise ??= (async () => {
    try {
      const [
        { setupWorker },
        { createHandlers },
        { mastersWriteGuard },
        { mockInviteAccept },
        { mockLeaveDayBlock },
      ] = await Promise.all([
        import('msw/browser'),
        import('@ariforce/contracts/mocks'),
        import('./mock-permissions'),
        import('./invites/mock-handler'),
        import('./leave/mock-handler'),
      ]);
      await setupWorker(
        ...mockInviteAccept(API_URL),
        ...mockLeaveDayBlock(API_URL),
        ...mastersWriteGuard(API_URL),
        ...createHandlers(API_URL),
      ).start({
        quiet: true,
      });
    } catch {
      /* fall through to the network */
    }
  })();
  return readyPromise;
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
  return a?.code ? { code: a.code, message: a.message ?? '', details: a.details } : { code: 'NETWORK', message: 'Could not reach the server.' };
}
