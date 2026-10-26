import createClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './generated/openapi';

/**
 * Typed API client (openapi-fetch). Types are generated from docs/api/openapi.json.
 * Web: cookies are sent with `credentials: 'include'`. Android: pass `headers: { Authorization: 'Bearer <token>' }`.
 */
export function createApiClient(baseUrl: string, options: Omit<ClientOptions, 'baseUrl'> = {}) {
  return createClient<paths>({ baseUrl, credentials: 'include', ...options });
}
export type ApiClient = ReturnType<typeof createApiClient>;
