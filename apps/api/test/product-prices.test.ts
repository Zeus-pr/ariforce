import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID as A } from '@ariforce/db';
import {
  AdminProduct,
  AdminProductList,
  ProductPricesBulkResponse,
  ProductPricesUpdate,
} from '@ariforce/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { createProduct } from './support';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const B = '01930000-0000-7000-8000-00000000000b';

describe('product prices contracts', () => {
  it('validates price shape', () => {
    expect(ProductPricesUpdate.safeParse({ ptr: 10.5 }).success).toBe(true);
    expect(ProductPricesUpdate.safeParse({ ptr: null }).success).toBe(true);
    expect(ProductPricesUpdate.safeParse({}).success).toBe(false);
    expect(ProductPricesUpdate.safeParse({ ptr: -1 }).success).toBe(false);
    expect(ProductPricesUpdate.safeParse({ ptr: 1.005 }).success).toBe(false);
    expect(ProductPricesUpdate.safeParse({ mrp: 1_000_001 }).success).toBe(false);
  });
});

describe.skipIf(!OWNER || !APP)('product prices admin (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let p1: string, p2: string, code2: string, bProduct: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    for (const who of ['sysadmin', 'director', 'rbm', 'bm', 'accountant', 'dh']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
    p1 = await createProduct(http, tok.bm!, tok.director!);
    p2 = await createProduct(http, tok.bm!, tok.director!);
    code2 = (await http().get(`/v1/products/${p2}`).set(as('bm'))).body.code;
    // A product in another company (RLS: must be invisible to company A's admin).
    await owner.query(
      `insert into companies (id, name, slug) values ($1, 'Other Pharma', 'other') on conflict do nothing`,
      [B],
    );
    const div = uuidv7();
    await owner.query(
      `insert into divisions (id, company_id, code, name) values ($1, $2, $3, 'B div')`,
      [div, B, `BD${div.slice(-6)}`],
    );
    bProduct = uuidv7();
    await owner.query(
      `insert into products (id, company_id, division_id, code, name, ptr) values ($1, $2, $3, $4, 'B product', 5)`,
      [bProduct, B, div, code2],
    );
  });
  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  it('system_admin only: 403 for everyone else, including director', async () => {
    for (const who of ['director', 'rbm', 'bm', 'accountant', 'dh']) {
      expect((await http().get('/v1/admin/products').set(as(who))).status, who).toBe(403);
      expect(
        (await http().patch(`/v1/admin/products/${p1}/prices`).set(as(who)).send({ ptr: 1 }))
          .status,
        who,
      ).toBe(403);
      expect(
        (
          await http()
            .post('/v1/admin/products/prices/bulk')
            .set(as(who))
            .send({ rows: [{ productId: p1, ptr: 1 }] })
        ).status,
        who,
      ).toBe(403);
      expect((await http().get(`/v1/admin/products/${p1}/price-history`).set(as(who))).status).toBe(
        403,
      );
    }
    // Generic masters route: director may edit a product but not its prices.
    const cur = (await http().get(`/v1/products/${p1}`).set(as('director'))).body;
    const r = await http()
      .patch(`/v1/products/${p1}`)
      .set(as('director'))
      .send({ ptr: 3, version: cur.version });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('PRICES_ADMIN_ONLY');
    const ok = await http()
      .patch(`/v1/products/${p1}`)
      .set(as('director'))
      .send({ name: cur.name, ptr: cur.ptr, version: cur.version });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('lists with search, missingPtr filter and cursor paging', async () => {
    const r = await http()
      .get('/v1/admin/products')
      .query({ missingPtr: 'true', limit: 200 })
      .set(as('sysadmin'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const list = AdminProductList.parse(r.body);
    expect(list.items.every((x) => x.ptr === null)).toBe(true);
    expect(list.items.some((x) => x.id === p1)).toBe(true);
    expect(list.items.some((x) => x.id === bProduct)).toBe(false);
    const q = await http()
      .get('/v1/admin/products')
      .query({ q: code2.toLowerCase() })
      .set(as('sysadmin'));
    expect(q.body.items.map((x: AdminProduct) => x.id)).toEqual([p2]);
    const page1 = await http().get('/v1/admin/products').query({ limit: 1 }).set(as('sysadmin'));
    expect(page1.body.items).toHaveLength(1);
    const page2 = await http()
      .get('/v1/admin/products')
      .query({ limit: 1, cursor: page1.body.nextCursor })
      .set(as('sysadmin'));
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
  });

  it('PATCH: validation, PTR <= MRP, version conflict, history and audit', async () => {
    const patch = (body: object, id = p1) =>
      http().patch(`/v1/admin/products/${id}/prices`).set(as('sysadmin')).send(body);
    expect((await patch({ ptr: -1 })).status).toBe(422);
    expect((await patch({ ptr: 1.234 })).status).toBe(422);
    expect((await patch({ ptr: 2_000_000 })).status).toBe(422);
    expect((await patch({})).status).toBe(422);
    expect((await patch({ ptr: 1 }, uuidv7())).status).toBe(404);
    expect((await patch({ ptr: 1 }, bProduct)).status).toBe(404); // other company
    const bad = await patch({ mrp: 10, ptr: 11 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('PTR_ABOVE_MRP');

    const r = await patch({ mrp: 20, ptr: 15.5, pts: 13.25 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const dto = AdminProduct.parse(r.body);
    expect(dto).toMatchObject({ mrp: 20, ptr: 15.5, pts: 13.25 });
    expect(dto.updatedBy?.id).toBeTruthy();
    const stale = await patch({ ptr: 14, version: dto.version - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    // Later MRP below current PTR is rejected on the merged row.
    expect((await patch({ mrp: 15 })).body.error.code).toBe('PTR_ABOVE_MRP');
    const same = await patch({ ptr: 15.5, version: dto.version });
    expect(same.status).toBe(200);

    const hist = await http().get(`/v1/admin/products/${p1}/price-history`).set(as('sysadmin'));
    expect(hist.body.items).toHaveLength(1); // the unchanged PATCH writes no history
    expect(hist.body.items[0]).toMatchObject({
      source: 'single',
      old: { mrp: null, ptr: null, pts: null },
      new: { mrp: 20, ptr: 15.5, pts: 13.25 },
    });
    const audit = await owner.query(
      `select before, after from audit_log where entity_id = $1 and action = 'product.prices_updated'`,
      [p1],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].before).toEqual({ mrp: null, ptr: null, pts: null });
    expect(audit.rows[0].after).toMatchObject({ mrp: 20, ptr: 15.5, pts: 13.25 });
    // History is append-only, even for the owner role.
    await expect(
      owner.query(`update product_price_history set new_ptr = 1 where product_id = $1`, [p1]),
    ).rejects.toThrow(/append-only/);
  });

  it('bulk: per-row results, partial success, summary, audit', async () => {
    const rows = [
      { productId: p2, ptr: 7.5 },
      { code: code2.toLowerCase(), mrp: 9 },
      { productId: p2, ptr: 7.5 },
      { code: 'NO-SUCH-CODE', ptr: 1 },
      { productId: p2, ptr: -3 },
      { productId: p2, code: code2, ptr: 1 },
      { productId: p2, ptr: 10 }, // above MRP 9
      { productId: p2 },
      'garbage',
    ];
    const r = await http()
      .post('/v1/admin/products/prices/bulk')
      .set(as('sysadmin'))
      .send({ rows });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const b = ProductPricesBulkResponse.parse(r.body);
    expect(b.summary).toEqual({ total: 9, updated: 2, unchanged: 1, failed: 6 });
    expect(b.results.map((x) => x.status)).toEqual([
      'updated',
      'updated',
      'unchanged',
      'failed',
      'failed',
      'failed',
      'failed',
      'failed',
      'failed',
    ]);
    expect(b.results[1]).toMatchObject({ productId: p2, productCode: code2 });
    expect(b.results[3]!.code).toBe('PRODUCT_NOT_FOUND');
    expect(b.results[4]!.code).toBe('VALIDATION');
    expect(b.results[6]!.code).toBe('PTR_ABOVE_MRP');
    // Company B has a product with the same code: never touched.
    expect(
      (await owner.query(`select ptr from products where id = $1`, [bProduct])).rows[0].ptr,
    ).toBe('5.00');
    const cur = (await http().get('/v1/admin/products').query({ q: code2 }).set(as('sysadmin')))
      .body.items[0];
    expect(cur).toMatchObject({ ptr: 7.5, mrp: 9 });
    const hist = await owner.query(
      `select count(*)::int as n from product_price_history where bulk_id = $1`,
      [b.bulkId],
    );
    expect(hist.rows[0].n).toBe(2);
    const audit = await owner.query(
      `select after from audit_log where entity_id = $1 and action = 'product.prices_bulk'`,
      [b.bulkId],
    );
    expect(audit.rows[0].after).toEqual(b.summary);

    expect(
      (await http().post('/v1/admin/products/prices/bulk').set(as('sysadmin')).send({ rows: [] }))
        .status,
    ).toBe(422);
    expect(
      (
        await http()
          .post('/v1/admin/products/prices/bulk')
          .set(as('sysadmin'))
          .send({ rows: Array.from({ length: 301 }, () => ({ productId: p2, ptr: 1 })) })
      ).status,
    ).toBe(422);
  });

  it('RLS: app role sees only its company history', async () => {
    await owner.query(
      `insert into product_price_history (id, company_id, product_id, new_ptr, source, changed_by)
       select $1, $2, $3, 5, 'single', id from users limit 1`,
      [uuidv7(), B, bProduct],
    );
    const app = new Pool({ connectionString: APP });
    try {
      const c = await app.connect();
      try {
        await c.query('begin');
        await c.query(`select set_config('app.current_company_id', $1, true)`, [A]);
        const r = await c.query(
          `select count(*)::int as n from product_price_history where company_id = $1`,
          [B],
        );
        expect(r.rows[0].n).toBe(0);
        await expect(
          c.query(
            `insert into product_price_history (id, company_id, product_id, new_ptr, source, changed_by)
             select $1, $2, $3, 1, 'single', id from users limit 1`,
            [uuidv7(), B, bProduct],
          ),
        ).rejects.toThrow();
        await c.query('rollback');
      } finally {
        c.release();
      }
    } finally {
      await app.end();
    }
  });
});
