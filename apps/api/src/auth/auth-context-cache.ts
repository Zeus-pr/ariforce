/**
 * Per-replica cache of the per-request auth context (roles + permissions, own territories, reporting
 * line with territory paths) that SessionGuard loads after the session and membership checks.
 *
 * - Key: `${companyId}:${userId}`. Session validity, membership and account status are never
 *   cached (SessionGuard checks them on every request), so a revoked session or a deactivated user
 *   is rejected immediately.
 * - TTL: AUTH_CONTEXT_CACHE_TTL_SECONDS (default 60, max 300, 0 = off). Bounded size (LRU-ish).
 * - Invalidation: any write that can change roles, territories, manager_id or users of a company
 *   goes through authContextWrite(), which drops that company's entries before the write and again
 *   after it settles (post-commit). A load that overlaps an invalidation is not stored (generation
 *   check), so a pre-commit read can never be cached past the write.
 * - Other replicas are not told: they serve the old context for at most the TTL (60 s default).
 */
export interface AuthContextRows {
  rs: { key: string; permissions: string[] }[];
  ts: { id: string; path: string }[];
  team: { user_id: string; path: string | null }[];
}

const MAX = 5000;
const entries = new Map<string, { until: number; value: AuthContextRows }>();
const generation = new Map<string, number>();
let globalGen = 0;

export function authContextTtlMs(): number {
  const raw = process.env.AUTH_CONTEXT_CACHE_TTL_SECONDS;
  const n = raw === undefined || raw === '' ? 60 : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300) * 1000 : 0;
}

const key = (companyId: string, userId: string) => `${companyId}:${userId}`;
const gen = (companyId: string) => `${globalGen}:${generation.get(companyId) ?? 0}`;

/** Drops a company's entries (or all with no id) and bumps its generation. */
export function invalidateAuthContext(companyId?: string) {
  if (!companyId) {
    globalGen++;
    entries.clear();
    return;
  }
  generation.set(companyId, (generation.get(companyId) ?? 0) + 1);
  const prefix = `${companyId}:`;
  for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k);
}

/** Wraps a write: invalidates now and again once it settles (after commit or rollback). */
export function authContextWrite<T>(companyId: string | undefined, work: Promise<T>): Promise<T>;
export function authContextWrite<T>(
  companyId: string | undefined,
  work: () => Promise<T>,
): Promise<T>;
export function authContextWrite<T>(
  companyId: string | undefined,
  work: Promise<T> | (() => Promise<T>),
): Promise<T> {
  invalidateAuthContext(companyId);
  const pr = typeof work === 'function' ? work() : work;
  return pr.finally(() => invalidateAuthContext(companyId));
}

/** Cached context, or load() (stored only if no invalidation happened meanwhile). */
export async function cachedAuthContext(
  companyId: string,
  userId: string,
  load: () => Promise<AuthContextRows>,
): Promise<AuthContextRows> {
  const ttl = authContextTtlMs();
  if (!ttl) return load();
  const k = key(companyId, userId);
  const now = Date.now();
  const hit = entries.get(k);
  if (hit && hit.until > now) {
    entries.delete(k); // refresh recency
    entries.set(k, hit);
    return hit.value;
  }
  const g = gen(companyId);
  const value = await load();
  if (gen(companyId) === g) {
    entries.delete(k);
    if (entries.size >= MAX) entries.delete(entries.keys().next().value!);
    entries.set(k, { until: Date.now() + ttl, value });
  }
  return value;
}

/** Test hook. */
export function authContextCacheSize() {
  return entries.size;
}

/** authContextWrite only when `affects` (e.g. a masters write on territories). */
export function authContextWriteIf<T>(
  affects: boolean,
  companyId: string,
  work: Promise<T>,
): Promise<T> {
  return affects ? authContextWrite(companyId, work) : work;
}
