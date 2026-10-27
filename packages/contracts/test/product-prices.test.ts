import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminProduct,
  AdminProductList,
  DEFAULT_ROLE_PERMISSIONS,
  ProductPricesBulkResponse,
  ROLE_KEYS,
} from '../src';
import { createHandlers } from '../src/mocks';

const BASE = 'http://prices.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const call = (who: string, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-mock-user': `${who}@demo.ariforce.in`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('product prices admin (mocks)', () => {
  it('products:prices belongs to system_admin only', () => {
    for (const k of ROLE_KEYS)
      expect(DEFAULT_ROLE_PERMISSIONS[k].includes('products:prices'), k).toBe(k === 'system_admin');
  });

  it('403 for director, list/patch/bulk/history for sysadmin', async () => {
    expect((await call('director', 'GET', '/v1/admin/products')).status).toBe(403);
    const list = AdminProductList.parse(
      await (await call('sysadmin', 'GET', '/v1/admin/products?limit=200')).json(),
    );
    const p = list.items[0]!;
    const missing = AdminProductList.parse(
      await (await call('sysadmin', 'GET', '/v1/admin/products?missingPtr=true')).json(),
    );
    expect(missing.items.every((x) => x.ptr === null)).toBe(true);

    const bad = await call('sysadmin', 'PATCH', `/v1/admin/products/${p.id}/prices`, {
      mrp: 1,
      ptr: 2,
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('PTR_ABOVE_MRP');
    const ok = await call('sysadmin', 'PATCH', `/v1/admin/products/${p.id}/prices`, {
      mrp: 50,
      ptr: 40.25,
      version: p.version,
    });
    expect(ok.status).toBe(200);
    const saved = AdminProduct.parse(await ok.json());
    expect(saved).toMatchObject({ ptr: 40.25, mrp: 50, version: p.version + 1 });
    const stale = await call('sysadmin', 'PATCH', `/v1/admin/products/${p.id}/prices`, {
      ptr: 1,
      version: p.version,
    });
    expect(stale.status).toBe(409);
    // The director cannot change a price through the generic masters route either.
    const masters = await call('director', 'PATCH', `/v1/products/${p.id}`, {
      ptr: 1,
      version: saved.version,
    });
    expect(masters.status).toBe(403);

    const bulk = await call('sysadmin', 'POST', '/v1/admin/products/prices/bulk', {
      rows: [
        { code: p.code, ptr: 41 },
        { code: 'NOPE', ptr: 1 },
        { productId: p.id, ptr: -1 },
      ],
    });
    const r = ProductPricesBulkResponse.parse(await bulk.json());
    expect(r.summary).toEqual({ total: 3, updated: 1, unchanged: 0, failed: 2 });
    expect(r.results[1]!.code).toBe('PRODUCT_NOT_FOUND');
    const hist = (await (
      await call('sysadmin', 'GET', `/v1/admin/products/${p.id}/price-history`)
    ).json()) as { items: unknown[] };
    expect(hist.items).toHaveLength(2);
  });
});
