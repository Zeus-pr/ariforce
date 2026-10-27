import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { pobValue } from '../src/dcr/dcr.service';
import { createProduct } from './support';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const ist = (d: Date) => new Date(d.getTime() + 5.5 * 36e5).toISOString().slice(0, 10);
// Yesterday (still editable until the end of today); leave.test.ts puts bm2 on leave today.
const DAY = ist(new Date(Date.now() - 864e5));
const OLD = ist(new Date(Date.now() - 10 * 864e5));
const RUN = Date.now().toString(36);

// bm2 (T.otherArea) on DAY: dcr.test.ts and kpis.test.ts use bm, leave.test.ts uses bm2 today.
describe.skipIf(!OWNER || !APP)('POB / RCPA at chemist calls (#40, real API)', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let field: string, doctor: string, chemist: string, stockist: string, hqChemist: string;
  let priced: string, unpriced: string, inactive: string;

  const outlet = async (kind: 'chemists' | 'stockists', territoryId: string) => {
    const r = await http()
      .post(`/v1/${kind}`)
      .set(as('director'))
      .send({
        territoryId,
        name: `${kind} ${RUN}`,
        gstin: null,
        drugLicenseNo: null,
        addressLine: null,
        city: 'Kolkata',
        state: null,
        pincode: null,
        location: null,
        phone: null,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const call = (over: Record<string, unknown> = {}) => ({
    clientId: uuidv7(),
    outletKind: 'chemist',
    outletId: chemist,
    jointWorkUserIds: [],
    productsDetailed: [],
    samples: [],
    pob: [],
    rcpa: [],
    checkInId: null,
    remarks: null,
    calledAt: new Date().toISOString(),
    ...over,
  });
  const put = (calls: unknown[], extra: Record<string, unknown> = {}, who = 'bm2') =>
    http()
      .put('/v1/dcrs')
      .set(as(who))
      .send({
        date: DAY,
        workTypeId: field,
        territoryIds: [T.otherArea],
        deviationReason: 'POB/RCPA test',
        calls,
        ...extra,
      });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['bm', 'bm2', 'rbm', 'director', 'sysadmin']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
    const wt = (await http().get('/v1/work-types?limit=50').set(as('bm2'))).body.items;
    field = wt.find((w: { kind: string }) => w.kind === 'field').id;
    doctor = (await http().get(`/v1/doctors?territoryId=${T.otherArea}&limit=1`).set(as('bm2')))
      .body.items[0].id;
    hqChemist = (await http().get(`/v1/chemists?territoryId=${T.hq}&limit=1`).set(as('bm'))).body
      .items[0].id;
    chemist = await outlet('chemists', T.otherArea);
    stockist = await outlet('stockists', T.otherArea);
    priced = await createProduct(http, tok.bm!, tok.director!, { ptr: 12.35, admin: tok.sysadmin });
    unpriced = await createProduct(http, tok.bm!, tok.director!, { ptr: null });
    inactive = await createProduct(http, tok.bm!, tok.director!, { active: false });
  });
  const rowsValue = async (dcrId: string, productId: string) => {
    const pool = new Pool({ connectionString: process.env.DIRECT_URL });
    try {
      const r = await pool.query(
        `select p.value from dcr_call_products p join dcr_calls c on c.id = p.call_id
         where c.dcr_id = $1 and p.product_id = $2 and p.kind = 'pob'
           and p.deleted_at is null and c.deleted_at is null`,
        [dcrId, productId],
      );
      return r.rows[0]?.value as string | undefined;
    } finally {
      await pool.end();
    }
  };
  afterAll(async () => {
    await app?.close();
  });

  it('pobValue: quantity × PTR to 2 dp, null without PTR', () => {
    expect(pobValue(3, '12.35')).toBe('37.05');
    expect(pobValue(7, '0.10')).toBe('0.70');
    expect(pobValue(3, null)).toBeNull();
  });

  it('saves POB + RCPA on a chemist call and reads them back (value from PTR)', async () => {
    const c = call({
      pob: [
        { productId: priced, quantity: 10, stockistId: stockist, value: 999 },
        { productId: unpriced, quantity: 4 },
      ],
      rcpa: [
        { productId: priced, quantity: 30, prescriptions: 6, doctorId: doctor },
        {
          productId: priced,
          competitorBrand: `  Dolo${RUN}   650 `,
          competitorCompany: 'Micro Labs',
          quantity: 50,
        },
        { productId: priced, competitorBrand: `Calpol${RUN}`, quantity: 20 },
      ],
    });
    const res = await put([c]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const got = res.body.calls[0];
    expect(got.pob).toEqual([
      { productId: priced, quantity: 10, stockistId: stockist, value: 123.5 },
      { productId: unpriced, quantity: 4, stockistId: null, value: null },
    ]);
    expect(got.rcpa).toHaveLength(3);
    expect(got.rcpa).toEqual(
      expect.arrayContaining([
        {
          productId: priced,
          competitorBrand: null,
          competitorCompany: null,
          quantity: 30,
          prescriptions: 6,
          doctorId: doctor,
        },
        {
          productId: priced,
          competitorBrand: `Dolo${RUN} 650`,
          competitorCompany: 'Micro Labs',
          quantity: 50,
          prescriptions: null,
          doctorId: null,
        },
      ]),
    );
    // GET returns the same lines; the old client shape (no rcpa) still saves and clears them.
    const one = await http().get(`/v1/dcrs/${res.body.id}`).set(as('bm2'));
    expect(one.body.calls[0].rcpa).toHaveLength(3);
    const { rcpa: _drop, ...legacy } = c;
    const v = res.body.version;
    const again = await put([{ ...legacy, pob: [] }], { version: v });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.calls[0]).toMatchObject({ id: c.clientId, pob: [], rcpa: [] });
    // Re-sending the full call restores the lines (idempotent on clientId, no duplicates).
    const back = await put([c]);
    const back2 = await put([c]);
    expect(back.status).toBe(200);
    expect(back2.body.calls).toHaveLength(1);
    expect(back2.body.calls[0].rcpa).toHaveLength(3);
    expect(back2.body.calls[0].pob).toHaveLength(2);
  });

  it('accepts POB on doctor calls, rejects RCPA on doctor/stockist calls', async () => {
    const docPob = call({
      outletKind: 'doctor',
      outletId: doctor,
      pob: [{ productId: priced, quantity: 1 }],
    });
    const stkRcpa = call({
      outletKind: 'stockist',
      outletId: stockist,
      pob: [{ productId: priced, quantity: 1 }],
      rcpa: [{ productId: priced, quantity: 1 }],
    });
    const docRcpa = call({
      outletKind: 'doctor',
      outletId: doctor,
      rcpa: [{ productId: priced, quantity: 1 }],
    });
    const r = await put([docPob, stkRcpa, docRcpa]);
    expect(r.status).toBe(422);
    expect(r.body.error.details.pobOutletCallIds).toBeUndefined();
    expect(r.body.error.details.rcpaOutletCallIds).toEqual([stkRcpa.clientId, docRcpa.clientId]);
    // POB alone on a stockist or doctor call is fine.
    const ok = await put([
      call(),
      docPob,
      call({
        outletKind: 'stockist',
        outletId: stockist,
        pob: [{ productId: priced, quantity: 2 }],
      }),
    ]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    type C = { outletKind: string; pob: { value: number | null }[] };
    const pobOf = (k: string) =>
      (ok.body.calls as C[]).find((c) => c.outletKind === k && c.pob.length)?.pob[0]?.value;
    expect(pobOf('doctor')).toBe(12.35);
    expect(pobOf('stockist')).toBe(24.7);
  });

  it('validates products, duplicates, quantities, stockist and doctor scope', async () => {
    const dup = call({
      pob: [
        { productId: priced, quantity: 1 },
        { productId: priced, quantity: 2 },
      ],
      rcpa: [
        { productId: priced, competitorBrand: 'Brand X', quantity: 1 },
        { productId: priced, competitorBrand: ' brand   x', quantity: 2 },
      ],
    });
    const r = await put([dup]);
    expect(r.status).toBe(422);
    expect(r.body.error.details).toMatchObject({
      duplicatePob: [dup.clientId],
      duplicateRcpa: [dup.clientId],
    });
    // Same brand under two different own products is two molecules: allowed.
    const twoMolecules = await put([
      call({
        rcpa: [
          { productId: priced, competitorBrand: 'Brand X', quantity: 1 },
          { productId: unpriced, competitorBrand: 'Brand X', quantity: 1 },
        ],
      }),
    ]);
    expect(twoMolecules.status, JSON.stringify(twoMolecules.body)).toBe(200);

    const unknown = uuidv7();
    const bad = await put([
      call({
        pob: [
          { productId: inactive, quantity: 1, stockistId: uuidv7() },
          { productId: unknown, quantity: 1 },
        ],
        rcpa: [{ productId: inactive, quantity: 1, doctorId: uuidv7() }],
      }),
    ]);
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toMatchObject({
      inactiveProductIds: [inactive],
      productIds: [unknown],
      stockistIds: [expect.any(String)],
      rcpaDoctorIds: [expect.any(String)],
    });
    // Outlets outside the rep's territory are rejected (existing rule, now with RCPA).
    const outOfScope = await put([
      call({ outletId: hqChemist, rcpa: [{ productId: priced, quantity: 1 }] }),
    ]);
    expect(outOfScope.status).toBe(422);
    expect(outOfScope.body.error.details.chemistIds).toEqual([hqChemist]);

    for (const line of [
      { productId: priced, quantity: 0 },
      { productId: priced, quantity: 1, prescriptions: -1 },
      { productId: priced, quantity: 1.5 },
      { productId: priced, quantity: 1, competitorCompany: 'Acme' },
      { productId: priced, quantity: 1, competitorBrand: '   ' },
      { productId: priced, quantity: 1, competitorBrand: 'x'.repeat(101) },
    ]) {
      const v = await put([call({ rcpa: [line] })]);
      expect(v.status, JSON.stringify(line)).toBe(422);
    }
    expect((await put([call({ pob: [{ productId: priced, quantity: 0 }] })])).status).toBe(422);
  });

  it('edit rules: locked day 409, stale version 409, only your own DCR', async () => {
    const locked = await put([call({ rcpa: [{ productId: priced, quantity: 1 }] })], {
      date: OLD,
    });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('DAY_LOCKED');
    const cur = await put([call({ rcpa: [{ productId: priced, quantity: 1 }] })]);
    expect(cur.status).toBe(200);
    const stale = await put([call()], { version: cur.body.version - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    // bm cannot write bm2's chemist (out of scope) and PUT always targets the caller's own DCR.
    const other = await put(
      [call({ rcpa: [{ productId: priced, quantity: 1 }] })],
      { territoryIds: [T.hq] },
      'bm',
    );
    expect(other.status).toBe(422);
    expect(other.body.error.details.chemistIds).toEqual([chemist]);
  });

  it('reads follow the DCR scope: owner and manager see RCPA, a peer gets 404', async () => {
    const saved = await put([
      call({ rcpa: [{ productId: priced, competitorBrand: `Scope${RUN}`, quantity: 3 }] }),
    ]);
    expect(saved.status).toBe(200);
    const id = saved.body.id;
    const mgr = await http().get(`/v1/dcrs/${id}`).set(as('rbm'));
    expect(mgr.status).toBe(200);
    expect(mgr.body.calls[0].rcpa[0].competitorBrand).toBe(`Scope${RUN}`);
    expect((await http().get(`/v1/dcrs/${id}`).set(as('bm'))).status).toBe(404);
  });

  it('competitor brand lookup: company-wide, case-insensitive, word-prefix search', async () => {
    await put([
      call({
        rcpa: [
          {
            productId: priced,
            competitorBrand: `Zyx${RUN} Forte`,
            competitorCompany: 'Acme',
            quantity: 1,
          },
          {
            productId: unpriced,
            competitorBrand: `ZYX${RUN} forte`,
            competitorCompany: 'Acme',
            quantity: 1,
          },
        ],
      }),
      call({
        rcpa: [{ productId: priced, competitorBrand: `Zyx${RUN} Plus`, quantity: 1 }],
      }),
    ]);
    const r = await http().get(`/v1/rcpa/competitor-brands?q=zyx${RUN}`).set(as('bm')); // another rep in the same company sees the shared list
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items).toEqual([
      {
        brand: expect.stringMatching(new RegExp(`^zyx${RUN} forte$`, 'i')),
        company: 'Acme',
        uses: 2,
      },
      { brand: `Zyx${RUN} Plus`, company: null, uses: 1 },
    ]);
    const word = await http().get('/v1/rcpa/competitor-brands?q=fort&limit=50').set(as('bm2'));
    expect(word.body.items.map((i: { brand: string }) => i.brand.toLowerCase())).toContain(
      `zyx${RUN} forte`,
    );
    const wild = await http().get('/v1/rcpa/competitor-brands?q=%25').set(as('bm2'));
    expect(wild.status).toBe(200);
    expect(wild.body.items).toEqual([]);
    expect((await http().get('/v1/rcpa/competitor-brands?limit=0').set(as('bm2'))).status).toBe(
      422,
    );
    expect((await http().get('/v1/rcpa/competitor-brands')).status).toBe(401);
  });

  // Last: it re-saves DAY for bm2 (other tests above use DAY too).
  it('a PTR change keeps saved POB values; new lines use the new PTR', async () => {
    const prod = await createProduct(http, tok.bm!, tok.director!, {
      ptr: 10,
      admin: tok.sysadmin,
    });
    const c = call({ pob: [{ productId: prod, quantity: 2 }] });
    const first = await put([c]);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.calls[0].pob[0].value).toBe(20);
    const pr = await http()
      .patch(`/v1/admin/products/${prod}/prices`)
      .set(as('sysadmin'))
      .send({ ptr: 12 });
    expect(pr.status, JSON.stringify(pr.body)).toBe(200);
    const read = await http().get(`/v1/dcrs/${first.body.id}`).set(as('bm2'));
    expect(read.body.calls[0].pob[0].value).toBe(20); // stored at write, never re-priced on read
    const kpi = await rowsValue(first.body.id, prod);
    expect(kpi).toBe('20.00');
    // A new line (another rep's DCR) is priced at the new PTR.
    const second = await put(
      [call({ outletId: hqChemist, pob: [{ productId: prod, quantity: 2 }] })],
      { territoryIds: [T.hq] },
      'bm',
    );
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.calls[0].pob[0].value).toBe(24);

    // Re-saving the draft unchanged (twice: idempotent re-send) keeps the saved value.
    for (let i = 0; i < 2; i++) {
      const again = await put([c]);
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body.calls[0].pob[0].value).toBe(20);
    }
    expect(await rowsValue(first.body.id, prod)).toBe('20.00');

    // Edited quantity = new line pricing (current PTR 12); an added product uses its current PTR.
    const prod2 = await createProduct(http, tok.bm!, tok.director!, {
      ptr: 5,
      admin: tok.sysadmin,
    });
    const edited = await put([
      {
        ...c,
        pob: [
          { productId: prod, quantity: 3 },
          { productId: prod2, quantity: 1 },
        ],
      },
    ]);
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const byProd = (b: { calls: { pob: { productId: string; value: number }[] }[] }, id: string) =>
      b.calls[0]!.pob.find((x) => x.productId === id)!.value;
    expect(byProd(edited.body, prod)).toBe(36);
    expect(byProd(edited.body, prod2)).toBe(5);
    // A later PTR change does not touch either line on another unchanged re-send.
    await http().patch(`/v1/admin/products/${prod}/prices`).set(as('sysadmin')).send({ ptr: 15 });
    const kept = await put([
      {
        ...c,
        pob: [
          { productId: prod, quantity: 3 },
          { productId: prod2, quantity: 1 },
        ],
      },
    ]);
    expect(byProd(kept.body, prod)).toBe(36);
    expect(byProd(kept.body, prod2)).toBe(5);
  });
});
