import { createApiClient } from '@ariforce/contracts';

/**
 * One switch (docs/RUN-LOCAL.md):
 *   NEXT_PUBLIC_API_MODE=mock|real   (default mock: MSW in the browser, no backend needed)
 *   NEXT_PUBLIC_API_BASE_URL=http://localhost:4000   (the API; used in both modes)
 * Real mode sends the better-auth session cookie cross-port (credentials: 'include').
 */
export const API_MODE: 'mock' | 'real' =
  process.env.NEXT_PUBLIC_API_MODE === 'real' ? 'real' : 'mock';
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const api = createApiClient(API_BASE_URL);
