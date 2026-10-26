import { createApiClient } from '@ariforce/contracts';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === 'enabled';

/** Typed client for the AriForce API. See docs/API-CONVENTIONS.md. */
export const api = createApiClient(API_URL);

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
      const [{ setupWorker }, { createHandlers }] = await Promise.all([
        import('msw/browser'),
        import('@ariforce/contracts/mocks'),
      ]);
      await setupWorker(...createHandlers(API_URL)).start({ quiet: true });
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
