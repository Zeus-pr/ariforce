import { toApiError } from '@/lib/api';

/** Plain words for a failed typed-client call (non-2xx), including non-JSON 5xx pages from a proxy. */
export function failureMessage(r: { error?: unknown; response?: Response }, fallback: string): string {
  const e = toApiError(r);
  const status = r.response?.status ?? 0;
  if (e.code === 'FORBIDDEN') return 'Your role can’t use this yet. Ask your administrator.';
  if (e.code !== 'NETWORK') return e.message || fallback;
  if (status >= 500) return `The server had a problem (HTTP ${status}). Try again in a moment.`;
  if (status === 404) return `${fallback} The server doesn’t have this yet.`;
  return fallback;
}

/** Message for a call that threw (offline, DNS, CORS, or the 8s timeout in lib/api). */
export function thrownMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'The server is taking too long to answer. Check your connection and retry.';
  return 'Could not reach the server. Check your connection and retry.';
}
