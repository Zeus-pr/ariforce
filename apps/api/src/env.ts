import * as z from 'zod';

const url = (https: boolean) =>
  z.string().refine(
    (v) => {
      try {
        const u = new URL(v);
        return https ? u.protocol === 'https:' : true;
      } catch {
        return false;
      }
    },
    https ? 'must be an https URL' : 'must be a URL',
  );
const nonEmpty = z.string().trim().min(1, 'is required');
const intStr = z.string().regex(/^\d+$/, 'must be a whole number');

/**
 * Production environment (#80). Validated once at boot; fatal on any problem. Dev and test stay
 * lenient (defaults in code). Messages carry variable NAMES only, never values.
 */
export const ProdEnv = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// connection string'),
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  BETTER_AUTH_URL: url(true),
  WEB_ORIGIN: z.string().refine((v) => {
    const list = v
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    return (
      list.length > 0 &&
      list.every((o) => {
        try {
          const u = new URL(o);
          return u.protocol === 'https:' && u.origin === o;
        } catch {
          return false;
        }
      })
    );
  }, 'must be a comma-separated list of https origins (no path, no wildcard)'),
  TRUST_PROXY: nonEmpty,
  R2_ACCOUNT_ID: nonEmpty,
  R2_ACCESS_KEY_ID: nonEmpty,
  R2_SECRET_ACCESS_KEY: nonEmpty,
  R2_BUCKET: nonEmpty,
  R2_ENDPOINT: url(true).optional(),
  R2_PUBLIC_URL: url(true).optional(),
  // Item F: invite and password-reset emails. Without a key nothing is sent (log only), so
  // production requires it. MAIL_FROM must be an address on a domain verified in Resend.
  RESEND_API_KEY: z.string().regex(/^re_\S{8,}$/, 'must be a Resend API key (re_...)'),
  MAIL_FROM: z
    .string()
    .regex(
      /^(?:[^<>]+ <[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/,
      'must be "Name <address@domain>" or an address',
    )
    .refine((v) => !/@localhost\b/i.test(v), 'must not be a localhost address'),
  PASSWORD_RESET_RATE_PER_IP: intStr.optional(),
  PASSWORD_RESET_RATE_PER_EMAIL: intStr.optional(),
  PORT: intStr.optional(),
  DB_POOL_MAX: intStr.optional(),
  SIGNUP_RATE_PER_IP: intStr.optional(),
  SIGNUP_RATE_PER_EMAIL: intStr.optional(),
  AUTH_RATE_PER_IP: intStr.optional(),
  INVITE_RATE_PER_IP: intStr.optional(),
  JOBS_RUNNER_ENABLED: z.enum(['true', 'false'], 'must be true or false').optional(),
  JOBS_POLL_MS: intStr.optional(),
  JOBS_BATCH_SIZE: intStr.optional(),
  JOBS_LOCK_TIMEOUT_S: intStr.optional(),
  SESSION_MAX_AGE_SECONDS: intStr
    .refine((v) => Number(v) >= 300 && Number(v) <= 2_592_000, 'must be 300..2592000')
    .optional(),
  AUTH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none'], 'must be lax, strict or none').optional(),
  AUTH_COOKIE_DOMAIN: z
    .string()
    .regex(/^[a-z0-9.-]+$/i, 'must be a bare domain like example.com')
    .optional(),
  CLIENT_IP_MODE: z
    .enum(['cloudflare', 'railway', 'socket'], 'must be cloudflare, railway or socket')
    .optional(),
  EXPENSE_APPROVAL_LEVELS: z.enum(['1', '2'], 'must be 1 or 2').optional(),
  INVITE_RETURN_LINK: z
    .string()
    .refine((v) => v !== 'true', 'must not be true in production (leaks invite links)')
    .optional(),
});

/** Problems as "NAME: reason" lines; empty when valid or not production. Never includes values. */
export function envProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  // Treat empty strings as unset so "X=" fails like a missing variable.
  const clean = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ''),
  );
  const r = ProdEnv.safeParse(clean);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const name = String(i.path[0] ?? '?');
    const missing = i.code === 'invalid_type' && clean[name] === undefined;
    return `${name}: ${missing ? 'is required' : i.message}`;
  });
}

/** Throws (boot stops) in production when the environment is incomplete or invalid. */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const p = envProblems(env);
  if (p.length) throw new Error(`Invalid production environment:\n- ${p.join('\n- ')}`);
}
