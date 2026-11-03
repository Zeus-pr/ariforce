import { afterEach, describe, expect, it } from 'vitest';
import {
  authContextWrite,
  cachedAuthContext,
  invalidateAuthContext,
  type AuthContextRows,
} from '../src/auth/auth-context-cache';

const ctx = (key: string): AuthContextRows => ({
  rs: [{ key, permissions: [] }],
  ts: [],
  team: [],
});

describe('auth context cache', () => {
  afterEach(() => {
    delete process.env.AUTH_CONTEXT_CACHE_TTL_SECONDS;
    invalidateAuthContext();
  });

  it('caches per company+user and isolates tenants', async () => {
    let n = 0;
    const load = (k: string) => async () => (n++, ctx(k));
    expect((await cachedAuthContext('c1', 'u1', load('a'))).rs[0]!.key).toBe('a');
    expect((await cachedAuthContext('c1', 'u1', load('b'))).rs[0]!.key).toBe('a');
    // same user id under another company is a separate entry
    expect((await cachedAuthContext('c2', 'u1', load('c'))).rs[0]!.key).toBe('c');
    expect(n).toBe(2);
    // invalidating c2 leaves c1 cached
    invalidateAuthContext('c2');
    expect((await cachedAuthContext('c1', 'u1', load('d'))).rs[0]!.key).toBe('a');
    expect((await cachedAuthContext('c2', 'u1', load('e'))).rs[0]!.key).toBe('e');
  });

  it('a write invalidates the company before and after it settles', async () => {
    await cachedAuthContext('c1', 'u1', async () => ctx('old'));
    let release!: () => void;
    const w = authContextWrite('c1', new Promise<void>((r) => (release = r)));
    // read during the write (pre-commit) is loaded but not stored
    expect((await cachedAuthContext('c1', 'u1', async () => ctx('mid'))).rs[0]!.key).toBe('mid');
    release();
    await w;
    expect((await cachedAuthContext('c1', 'u1', async () => ctx('new'))).rs[0]!.key).toBe('new');
  });

  it('a load overlapping an invalidation is not stored', async () => {
    let finish!: (v: AuthContextRows) => void;
    const p = cachedAuthContext('c1', 'u1', () => new Promise((r) => (finish = r)));
    invalidateAuthContext('c1');
    finish(ctx('stale'));
    await p;
    expect((await cachedAuthContext('c1', 'u1', async () => ctx('fresh'))).rs[0]!.key).toBe(
      'fresh',
    );
  });

  it('TTL 0 disables caching', async () => {
    process.env.AUTH_CONTEXT_CACHE_TTL_SECONDS = '0';
    await cachedAuthContext('c1', 'u1', async () => ctx('a'));
    expect((await cachedAuthContext('c1', 'u1', async () => ctx('b'))).rs[0]!.key).toBe('b');
  });

  it('switching company reads the other tenant entry', async () => {
    await cachedAuthContext('c1', 'u1', async () => ctx('c1'));
    expect((await cachedAuthContext('c2', 'u1', async () => ctx('c2'))).rs[0]!.key).toBe('c2');
  });
});
