import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const RUN = Math.random().toString(36).slice(2, 7).toUpperCase();

// Integration against the throwaway SSD Postgres (scripts/test-db.sh). Skipped without a DB.
describe.skipIf(!OWNER || !APP)('masters + import (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['sysadmin', 'director', 'bm', 'abm', 'rbm']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      expect(res.status).toBe(200);
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
  });
  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  it('lists with total, sort, filter, q and an opaque cursor', async () => {
    const p1 = await http()
      .get('/v1/territories?limit=2&sort=code&includeTotal=true')
      .set(as('sysadmin'));
    expect(p1.status, JSON.stringify(p1.body)).toBe(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.total).toBeGreaterThanOrEqual(6);
    expect(p1.body.items[0].code <= p1.body.items[1].code).toBe(true);
    const p2 = await http()
      .get(`/v1/territories?limit=2&sort=code&cursor=${encodeURIComponent(p1.body.nextCursor)}`)
      .set(as('sysadmin'));
    expect(p2.body.items[0].code >= p1.body.items[1].code).toBe(true);
    const hq = await http().get('/v1/territories?level=headquarter&q=hq1').set(as('sysadmin'));
    expect(hq.body.items.map((t: { code: string }) => t.code)).toContain('KOL-N-HQ1');
    const bad = await http().get('/v1/territories?sort=path').set(as('sysadmin'));
    expect(bad.status).toBe(422);
    const sub = await http().get(`/v1/territories?ancestorId=${T.area}`).set(as('sysadmin'));
    expect(sub.body.items.every((t: { path: string }) => t.path.includes(T.area))).toBe(true);
    const bm = await http().get('/v1/territories?includeTotal=true').set(as('bm'));
    expect(bm.body.total).toBe(1); // BM sees only their HQ
    const sp = await http().get('/v1/specialties').set(as('bm'));
    expect(sp.body.items.length).toBeGreaterThanOrEqual(2);
    const cats = await http().get('/v1/doctor-categories?sort=code').set(as('bm'));
    expect(cats.body.items[0]).toMatchObject({ code: 'A', visitsPerMonth: 3 });
  });

  it('import: dry run -> apply with the snake_case code template, duplicates and errors', async () => {
    const div = `D${RUN}`;
    const dRes = await http()
      .post('/v1/divisions/import')
      .set(as('director'))
      .send({ dryRun: false, rows: [{ code: div, name: `Division ${RUN}`, active: 'Y' }] });
    expect(dRes.status, JSON.stringify(dRes.body)).toBe(201);
    expect(dRes.body.totals.created).toBe(1);

    const products = [
      {
        code: `P${RUN}1`,
        name: 'Paracet 500',
        division_code: div,
        mrp: '25.50',
        is_sample: 'Y',
        form: 'Tablet',
      },
      // camelCase alias accepted
      { code: `P${RUN}2`, name: 'Cough Syrup', divisionCode: div, ptr: 12 },
      { code: `P${RUN}1`, name: 'Again', division_code: div }, // in-file duplicate
      { code: `P${RUN}3`, name: 'Bad', division_code: 'NOPE', mrp: 'abc' },
    ];
    const key = `k-${RUN}`;
    const dry = await http()
      .post('/v1/products/import')
      .set(as('director'))
      .set('idempotency-key', key)
      .send({ dryRun: true, rows: products });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.results.map((r: { status: string }) => r.status)).toEqual([
      'valid',
      'valid',
      'error',
      'error',
    ]);
    expect(dry.body.results[2].duplicateRule).toBe('in_file');
    const cols = dry.body.results[3].errors.map((e: { column: string }) => e.column).sort();
    expect(cols).toEqual(['division_code', 'mrp']);
    const none = await http().get(`/v1/products?q=P${RUN}`).set(as('director'));
    expect(none.body.items).toHaveLength(0); // dry run writes nothing to products

    const apply = await http()
      .post('/v1/products/import')
      .set(as('director'))
      .set('idempotency-key', key)
      .send({ dryRun: false, rows: products });
    expect(apply.status).toBe(201);
    expect(apply.body.totals).toMatchObject({ created: 2, error: 2 });
    const again = await http()
      .post('/v1/products/import')
      .set(as('director'))
      .set('idempotency-key', key)
      .send({ dryRun: false, rows: products });
    expect(again.body.id).toBe(apply.body.id); // idempotent replay
    const job = await http().get(`/v1/imports/${apply.body.id}`).set(as('director'));
    expect(job.body.results).toHaveLength(4);

    const list = await http()
      .get(`/v1/products?q=P${RUN}&sort=-code&includeTotal=true`)
      .set(as('bm'));
    expect(list.body.total).toBe(2);
    expect(list.body.items[0]).toMatchObject({ code: `P${RUN}2`, ptr: 12 });
    expect(list.body.items[1]).toMatchObject({ mrp: 25.5, isSample: true, form: 'tablet' });

    // re-import with onDuplicate=update
    const upd = await http()
      .post('/v1/products/import')
      .set(as('director'))
      .send({
        dryRun: false,
        onDuplicate: 'update',
        rows: [{ code: `p${RUN}1`, name: 'Paracet 650', division_code: div }],
      });
    expect(upd.body.results[0]).toMatchObject({ status: 'updated', duplicateRule: 'code' });

    // HQ mapping by code
    const hq = await http()
      .post('/v1/product-hq-mappings/import')
      .set(as('sysadmin'))
      .send({ dryRun: false, rows: [{ hq_code: 'KOL-N-HQ1', division_code: div }] });
    expect(hq.body.totals.created).toBe(1);
    const mapped = await http().get(`/v1/products?territoryId=${T.hq}&q=P${RUN}`).set(as('bm'));
    expect(mapped.body.items).toHaveLength(2);
  });

  it('doctor import resolves codes and applies #26 rules; BM is 403 (imports:write)', async () => {
    const reg = `REG-${RUN}`;
    const rows = [
      {
        name: `Dr. Import ${RUN}`,
        territory_code: 'kol-n-hq1',
        specialty_code: 'GP',
        category_code: 'a',
        registration_no: reg,
        pincode: '700001',
        lat: '22.57',
        lng: '88.36',
      },
      { name: `Import ${RUN}`, territory_code: 'KOL-N-HQ1', pincode: '700001' }, // name w/o Dr. + pincode in file
    ];
    const forbidden = await http().post('/v1/doctors/import').set(as('bm')).send({ rows });
    expect(forbidden.status).toBe(403);
    const res = await http()
      .post('/v1/doctors/import')
      .set(as('director'))
      .send({ dryRun: false, rows });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results[0].status).toBe('created');
    expect(res.body.results[1]).toMatchObject({ status: 'error', duplicateRule: 'in_file' });
    const dup = await http()
      .post('/v1/doctors/import')
      .set(as('director'))
      .send({
        rows: [
          { name: 'Someone', territory_code: 'KOL-N-HQ1', registration_no: reg.toLowerCase() },
        ],
      });
    expect(dup.body.results[0]).toMatchObject({
      status: 'duplicate',
      duplicateRule: 'registration_no',
    });
    const doc = await http().get(`/v1/doctors/${res.body.results[0].id}`).set(as('bm'));
    expect(doc.body).toMatchObject({ registrationNo: reg, location: { lat: 22.57, lng: 88.36 } });
  });

  it('CRUD: PATCH with version (409 on stale), soft DELETE, scope on writes', async () => {
    const created = await http()
      .post('/v1/chemists')
      .set(as('rbm'))
      .send({
        territoryId: T.hq,
        name: `Chem ${RUN}`,
        gstin: null,
        drugLicenseNo: null,
        addressLine: null,
        city: 'Kolkata',
        state: null,
        pincode: null,
        location: null,
        phone: null,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    const ok = await http()
      .patch(`/v1/chemists/${id}`)
      .set(as('rbm'))
      .send({ version: 1, city: 'Howrah' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ city: 'Howrah', version: 2 });
    const stale = await http()
      .patch(`/v1/chemists/${id}`)
      .set(as('rbm'))
      .send({ version: 1, city: 'X' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const moveOut = await http()
      .patch(`/v1/chemists/${id}`)
      .set(as('rbm'))
      .send({ version: 2, territoryId: T.zone });
    expect(moveOut.status).toBe(403);
    const prodWrite = await http().post('/v1/products').set(as('rbm')).send({
      code: 'X',
      name: 'X',
      divisionId: T.hq,
      brand: null,
      composition: null,
      packSize: null,
      form: null,
      mrp: null,
      ptr: null,
      pts: null,
      isSample: false,
      active: true,
    });
    expect(prodWrite.status).toBe(403); // company-wide master
    const del = await http().delete(`/v1/chemists/${id}`).set(as('rbm'));
    expect(del.status).toBe(204);
    expect((await http().get(`/v1/chemists/${id}`).set(as('rbm'))).status).toBe(404);
    const since = await http()
      .get(`/v1/chemists?updatedSince=${encodeURIComponent(created.body.createdAt)}`)
      .set(as('rbm'));
    expect(since.body.items.find((c: { id: string }) => c.id === id)?.deletedAt).toBeTruthy();
  });

  it('territory import builds paths from parent codes (incl. rows earlier in the file)', async () => {
    const res = await http()
      .post('/v1/territories/import')
      .set(as('sysadmin'))
      .send({
        dryRun: false,
        rows: [
          { code: `A${RUN}`, name: 'New area', level: 'area', parent_code: 'WB' },
          { code: `H${RUN}`, name: 'New HQ', level: 'headquarter', parent_code: `A${RUN}` },
          { code: `X${RUN}`, name: 'Orphan', level: 'zone' },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'created',
      'created',
      'error',
    ]);
    const t = await http().get(`/v1/territories/${res.body.results[1].id}`).set(as('sysadmin'));
    expect(t.body.path.startsWith(`${T.national}.${T.zone}.${T.region}.`)).toBe(true);
    expect(t.body.parentId).toBe(res.body.results[0].id);
  });

  it('presigned upload: import_source needs imports:write and a spreadsheet type', async () => {
    const bad = await http()
      .post('/v1/files/upload-url')
      .set(as('director'))
      .send({ purpose: 'import_source', contentType: 'image/png', sizeBytes: 10 });
    expect(bad.status).toBe(422);
    const bm = await http()
      .post('/v1/files/upload-url')
      .set(as('bm'))
      .send({ purpose: 'import_source', contentType: 'text/csv', sizeBytes: 10 });
    expect(bm.status).toBe(403);
    const wrongKey = await http()
      .post('/v1/divisions/import')
      .set(as('director'))
      .send({ fileKey: 'other/doctor_photo/x.csv', rows: [{ code: 'Z', name: 'Z' }] });
    expect(wrongKey.status).toBe(422);
  });
});
