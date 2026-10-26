import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildOpenApiDocument,
  DEFAULT_ROLE_PERMISSIONS,
  MASTERS_WRITE_MIN_RANK,
  ROLE_KEYS,
  ROLE_RANK,
} from '../src';
import { createHandlers } from '../src/mocks';

const BASE = 'http://perms.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const canWrite = (k: (typeof ROLE_KEYS)[number]) =>
  k === 'system_admin' || ROLE_RANK[k] >= MASTERS_WRITE_MIN_RANK;

describe('masters write = RBM and above + system_admin', () => {
  it('default permissions per tier', () => {
    for (const k of ROLE_KEYS) {
      const p = DEFAULT_ROLE_PERMISSIONS[k];
      for (const w of ['masters:write', 'territories:write', 'imports:write'] as const)
        expect(p.includes(w), `${k} ${w}`).toBe(canWrite(k));
    }
    expect(DEFAULT_ROLE_PERMISSIONS.business_manager).toContain('masters:read');
    expect(DEFAULT_ROLE_PERMISSIONS.area_business_manager).toContain('masters:read');
  });

  it.each(ROLE_KEYS)('mock: %s write gate on doctors / import / imports/{id}', async (k) => {
    const h = { 'x-mock-user': k, 'content-type': 'application/json' };
    const post = await fetch(`${BASE}/v1/doctors`, { method: 'POST', headers: h, body: '{}' });
    const imp = await fetch(`${BASE}/v1/chemists/import`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ dryRun: true, rows: [] }),
    });
    const job = await fetch(`${BASE}/v1/imports/00000000-0000-0000-0000-000000000000`, {
      headers: h,
    });
    for (const r of [post, imp, job])
      if (canWrite(k)) expect(r.status).not.toBe(403);
      else expect(r.status).toBe(403);
  });

  it('OpenAPI annotates masters endpoints', () => {
    const d = buildOpenApiDocument() as unknown as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    expect(d.paths['/v1/doctors']!.post!['x-required-permissions']).toEqual(['masters:write']);
    expect(d.paths['/v1/doctors']!.get!['x-required-permissions']).toEqual(['masters:read']);
    expect(d.paths['/v1/doctors/import']!.post!['x-required-permissions']).toEqual([
      'imports:write',
      'masters:write',
    ]);
    expect(d.paths['/v1/imports/{id}']!.get!['x-required-permissions']).toEqual(['imports:write']);
  });
});
