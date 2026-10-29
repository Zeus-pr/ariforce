import { ApiError } from '../api';
import { dcrErrorMessage } from './model';

/** Message when a fetch throws (offline / timeout). */
export function thrownMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'TimeoutError' || name === 'AbortError')
    return 'The server is taking too long to answer. Check your connection and retry.';
  if (e instanceof ApiError) return dcrErrorMessage(e);
  return 'Could not reach the server. Check your connection and retry.';
}

/** Prefer redesign codes; fall back to the API message. */
export function saveMessage(e: unknown): string {
  if (e instanceof ApiError) return dcrErrorMessage(e);
  return thrownMessage(e);
}
