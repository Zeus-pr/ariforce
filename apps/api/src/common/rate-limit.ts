import { HttpException } from '@nestjs/common';
import { AUTH_STATE_CODES } from '@ariforce/contracts';

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfter: number;
}

/**
 * Shared rate-limit store (#77). Fixed window per key. Swap the in-memory store for a shared one
 * (Redis/Upstash/Postgres) with setRateLimitStore() when the API runs on more than one instance.
 */
export interface RateLimitStore {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  reset(): Promise<void>;
}

/** Single-instance only: counters live in this process. */
export class MemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, { n: number; reset: number }>();
  private sweepAt = 0;
  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    if (now > this.sweepAt) {
      for (const [k, h] of this.hits) if (h.reset <= now) this.hits.delete(k);
      this.sweepAt = now + 60_000;
    }
    let h = this.hits.get(key);
    if (!h || h.reset <= now) this.hits.set(key, (h = { n: 0, reset: now + windowMs }));
    h.n += 1;
    return { allowed: h.n <= limit, retryAfter: Math.max(1, Math.ceil((h.reset - now) / 1000)) };
  }
  async reset() {
    this.hits.clear();
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();
export const rateLimitStore = () => store;
export const setRateLimitStore = (s: RateLimitStore) => {
  store = s;
};

/** 429 with the standard error envelope; ErrorFilter adds the Retry-After header. */
export class RateLimitedException extends HttpException {
  constructor(
    readonly retryAfter: number,
    message = 'Too many requests; try again later',
  ) {
    super(
      { code: AUTH_STATE_CODES.rateLimited, message, details: { retryAfterSeconds: retryAfter } },
      429,
    );
  }
}

/** Checks every rule; throws RateLimitedException on the first one exceeded. */
export async function enforce(
  rules: { key: string; limit: number; windowMs: number }[],
  message?: string,
) {
  for (const r of rules) {
    const res = await store.hit(r.key, r.limit, r.windowMs);
    if (!res.allowed) throw new RateLimitedException(res.retryAfter, message);
  }
}

const num = (name: string, def: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
};
const MIN = 60_000;
const HOUR = 3600_000;
/** Limits per client IP (env overrides, read per request). */
export const LIMITS = {
  signIn: () => ({ limit: num('AUTH_RATE_PER_IP', 20), windowMs: 15 * MIN }),
  authOther: () => ({ limit: num('AUTH_RATE_PER_IP', 20) * 3, windowMs: 15 * MIN }),
  inviteAccept: () => ({ limit: num('INVITE_RATE_PER_IP', 10), windowMs: HOUR }),
  signupSubmitIp: () => ({ limit: num('SIGNUP_RATE_PER_IP', 10), windowMs: HOUR }),
  signupSubmitEmail: () => ({ limit: num('SIGNUP_RATE_PER_EMAIL', 3), windowMs: HOUR }),
  signupOptions: () => ({ limit: num('SIGNUP_RATE_PER_IP', 10) * 6, windowMs: HOUR }),
};
