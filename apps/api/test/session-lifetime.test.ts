import { describe, expect, it } from 'vitest';
import {
  SESSION_IDLE_S,
  SESSION_MAX_AGE_S,
  SESSION_UPDATE_AGE_S,
  sessionPastMaxAge,
} from '../src/auth/auth';

describe('session lifetime', () => {
  it('18 h sliding idle window refreshed at most hourly, 7 day absolute cap', () => {
    expect(SESSION_IDLE_S).toBe(18 * 3600);
    expect(SESSION_UPDATE_AGE_S).toBeLessThan(SESSION_IDLE_S);
    expect(SESSION_MAX_AGE_S).toBe(7 * 86400);
  });
  it('sessionPastMaxAge', () => {
    const now = new Date('2026-11-10T00:00:00Z');
    expect(sessionPastMaxAge(new Date('2026-11-03T00:00:01Z'), now)).toBe(false);
    expect(sessionPastMaxAge('2026-11-02T23:59:59Z', now)).toBe(true);
  });
});
