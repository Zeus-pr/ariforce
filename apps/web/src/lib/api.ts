import { createApiClient } from '@ariforce/contracts';

/** Typed client for the AriForce API. See docs/API-CONVENTIONS.md (mock mode: NEXT_PUBLIC_API_MOCKING). */
export const api = createApiClient(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');
