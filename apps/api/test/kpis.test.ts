import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarWorkingDates } from '@ariforce/contracts';
import { T, U } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  createProduct,
  ensureFieldReady,
  ensureOutletLocked,
  ensureVisitCheckIn,
  geoCap,
  insertStaff,
} from './support';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const TODAY = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
const DAY = TODAY;

describe.skipIf(!OWNER || !APP)('KPIs (real API, 0009 views)', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let bmId: string, product: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['director', 'bm', 'abm']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
    const staff = await insertStaff(`kpi-${Date.now()}@example.test`, 'business_manager', U.area, [
      T.hq,
    ]);
    tok.bm = staff.bearer;
    const wt = (await http().get('/v1/work-types?limit=50').set(as('bm'))).body.items;
    const field = wt.find((w: { kind: string }) => w.kind === 'field').id;
    const doctor = (await http().get('/v1/doctors?approvalStatus=approved&limit=1').set(as('bm')))
      .body.items[0].id;
    const chemist = (await http().get(`/v1/chemists?territoryId=${T.hq}&limit=1`).set(as('bm')))
      .body.items[0].id;
    // PTS 300 → the server values the 5-unit POB at 1500 (#40: value = quantity × PTS).
    product = await createProduct(http, tok.bm!, tok.director!, { pts: 300 });
    // Call check-in + Presentation gates: punch-in, locks, visits, then submit.
    await ensureFieldReady(http, tok.bm!);
    await ensureOutletLocked(http, tok.bm!, 'doctor', doctor);
    await ensureOutletLocked(http, tok.bm!, 'chemist', chemist);
    const docVisit = await ensureVisitCheckIn(http, tok.bm!, 'doctor', doctor);
    const chemVisit = await ensureVisitCheckIn(http, tok.bm!, 'chemist', chemist);
    const res = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({
        date: DAY,
        workTypeId: field,
        territoryIds: [T.hq],
        deviationReason: 'KPI test day',
        submit: true,
        calls: [
          {
            clientId: uuidv7(),
            outletKind: 'doctor',
            outletId: doctor,
            checkInId: docVisit,
            remarks: null,
            jointWorkUserIds: [],
            productsDetailed: [{ productId: product, order: 1 }],
            samples: [{ productId: product, quantity: 3 }],
            pob: [],
            presentationOpenedAt: new Date().toISOString(),
            presentationCapture: geoCap(),
            calledAt: new Date().toISOString(),
          },
          {
            clientId: uuidv7(),
            outletKind: 'chemist',
            outletId: chemist,
            checkInId: chemVisit,
            remarks: null,
            jointWorkUserIds: [],
            productsDetailed: [],
            samples: [],
            pob: [{ productId: product, quantity: 5, stockistId: null, value: 1 }],
            calledAt: new Date().toISOString(),
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    bmId = res.body.userId;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('self report reads the views and counts working days', async () => {
    const r = await http()
      .get(
        `/v1/kpis?from=${DAY}&to=${DAY}&kpis=call_average,dcr_compliance_pct,pob_value,coverage_pct`,
      )
      .set(as('bm'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = r.body.rows[0];
    expect(row.userId).toBe(bmId);
    expect(row.workingDays).toBe(calendarWorkingDates(DAY, DAY).length);
    const m = Object.fromEntries(row.metrics.map((x: { kpi: string }) => [x.kpi, x]));
    expect(Object.keys(m)).toHaveLength(4);
    expect(m.call_average).toMatchObject({ numerator: 1, denominator: 1, value: 1 });
    expect(m.pob_value.value).toBe(1500);
    if (row.workingDays) expect(m.dcr_compliance_pct.value).toBe(100);
    expect(m.coverage_pct.denominator).toBeGreaterThan(0);

    const month = await http()
      .get(`/v1/kpis?month=${DAY.slice(0, 7)}`)
      .set(as('bm'));
    expect(month.body.rows[0].metrics).toHaveLength(18);
    expect(month.body.rows[0].workingDays).toBeGreaterThan(0);
  });

  it('rollups are scoped: byUser/team for managers, company for director only', async () => {
    const by = await http().get('/v1/kpis?rollup=byUser&kpis=call_average').set(as('abm'));
    expect(by.status).toBe(200);
    expect(by.body.rows.map((r: { userId: string }) => r.userId)).toContain(bmId);
    expect((await http().get('/v1/kpis?rollup=team').set(as('abm'))).status).toBe(200);
    expect((await http().get('/v1/kpis?rollup=company').set(as('abm'))).status).toBe(403);
    expect((await http().get('/v1/kpis?rollup=company').set(as('director'))).status).toBe(200);
    const terr = await http().get(`/v1/kpis?rollup=byTerritory&territoryId=${T.hq}`).set(as('abm'));
    expect(terr.status, JSON.stringify(terr.body)).toBe(200);
    expect(terr.body.rows.length).toBeGreaterThan(0);
    expect((await http().get('/v1/kpis?month=2026-01&month=x').set(as('bm'))).status).toBe(422);
  });

  it('product report and DCR territory filter', async () => {
    const r = await http().get(`/v1/kpis/products?from=${DAY}&to=${DAY}`).set(as('bm'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = r.body.rows.find((x: { productId: string }) => x.productId === product);
    // kpi_product_month is month grain: other tests' calls this month may add to it.
    expect(row.detailedCalls).toBeGreaterThanOrEqual(1);
    expect(row.pobValue).toBeGreaterThanOrEqual(1500);
    const dcrs = await http()
      .get(`/v1/dcrs?territoryId=${T.hq}&from=${DAY}&to=${DAY}`)
      .set(as('abm'));
    expect(dcrs.status, JSON.stringify(dcrs.body)).toBe(200);
    expect(dcrs.body.items.some((item: { userId: string }) => item.userId === bmId)).toBe(true);
  });
});
