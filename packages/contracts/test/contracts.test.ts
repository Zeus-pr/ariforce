import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApiDocument, createApiClient } from '../src';
import { createHandlers } from '../src/mocks';

const BASE = 'http://api.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());

describe('contracts', () => {
  it('builds an OpenAPI 3.1 document with the core paths', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    for (const p of [
      '/v1/me',
      '/v1/roles',
      '/v1/territories',
      '/v1/doctors',
      '/v1/doctors/{id}',
      '/v1/auth/sign-in/email',
    ])
      expect(doc.paths).toHaveProperty([p]);
  });

  it('typed client talks to the MSW mock', async () => {
    const api = createApiClient(BASE);
    const me = await api.GET('/v1/me');
    expect(me.data?.roles).toContain('admin');
    const list = await api.GET('/v1/doctors', { params: { query: { limit: 10 } } });
    expect(list.data?.items.length).toBeGreaterThan(0);
    const doc = list.data!.items[0]!;
    const upd = await api.PATCH('/v1/doctors/{id}', {
      params: { path: { id: doc.id } },
      body: { name: 'Dr. B', version: doc.version },
    });
    expect(upd.data?.version).toBe(doc.version + 1);
    const stale = await api.PATCH('/v1/doctors/{id}', {
      params: { path: { id: doc.id } },
      body: { name: 'x', version: doc.version },
    });
    expect(stale.response.status).toBe(409);
  });
});
