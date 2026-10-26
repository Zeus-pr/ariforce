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
export const setUnauthenticatedHandler = (fn: () => void) => {
  onUnauthenticated = fn;
};
api.use({
  // A hung or unreachable API must end in an error state, never an endless spinner.
  onRequest({ request }) {
    if (REAL && !request.signal?.aborted) return new Request(request, { signal: AbortSignal.timeout(8000) });
    return request;
  },
  onResponse({ response, request }) {
    if (REAL && response.status === 401 && !new URL(request.url).pathname.startsWith('/v1/auth/'))
      onUnauthenticated?.();
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
      const [{ setupWorker }, { createHandlers }, { mastersWriteGuard }] = await Promise.all([
        import('msw/browser'),
        import('@ariforce/contracts/mocks'),
        import('./mock-permissions'),
      ]);
      await setupWorker(...mastersWriteGuard(API_URL), ...createHandlers(API_URL)).start({
        quiet: true,
      });
    } catch {
      /* fall through to the network */
    }
  })();
  return readyPromise;
}

export type ApiError = { code: string; message: string; details?: unknown };

export function toApiError(error: unknown): ApiError {
  const e = (error as { error?: ApiError } | undefined)?.error;
  return e ?? { code: 'NETWORK', message: 'Could not reach the server.' };
}
