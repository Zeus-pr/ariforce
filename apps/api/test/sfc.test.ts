import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID as A, T, U } from '@ariforce/db';
import { SfcEmployeeList, SfcHqList, SfcTable, sfcAmounts } from '@ariforce/contracts';
import { bearerFor, insertStaff } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';

describe('sfcAmounts', () => {
  it('computes both-way km and amounts at the rate, null for actual fare', () => {
    expect(sfcAmounts(30, false, 2.95)).toEqual({
      bothWayKm: 60,
      oneWayAmount: 88.5,
      bothWayAmount: 177,
    });
    expect(sfcAmounts(102, true, 2.95)).toEqual({
      bothWayKm: 204,
      oneWayAmount: null,
      bothWayAmount: null,
    });
    expect(sfcAmounts(0, false, 2.95).oneWayAmount).toBe(0);
  });
});

describe.skipIf(!OWNER || !APP)('SFC routes (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  const url = (u: string) => `/v1/sfc/employees/${u}/routes`;
  const clean = () => owner.query(`delete from sfc_routes where company_id = $1`, [A]);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    await clean();
    for (const who of ['bm', 'bm2', 'abm', 'director', 'sysadmin', 'accountant']) {
      tok[who] = await bearerFor(http, who, PASSWORD);
    }
  });
  afterAll(async () => {
    await clean();
    await owner?.end();
    await app?.close();
  });

  it('settings: default rate 2.95', async () => {
    const r = await http().get('/v1/sfc/settings').set(as('bm'));
    expect(r.status).toBe(200);
    expect(r.body.ratePerKm).toBe(2.95);
  });

  it('ABM saves a BM table; server computes amounts; BM reads it but cannot write', async () => {
    const g = await http().get(url(U.rep)).set(as('abm'));
    expect(g.status).toBe(200);
    const t0 = SfcTable.parse(g.body);
    expect(t0.canEdit).toBe(true);
    expect(t0.hqTerritoryId).toBe(T.hq);
    const put = await http()
      .put(url(U.rep))
      .set(as('abm'))
      .send({
        etag: t0.etag,
        hqTerritoryId: T.hq,
        routes: [
          { fromPlace: 'Alpha', toPlace: 'Alpha', oneWayKm: 0, travelMode: 'bike', category: 'HQ' },
          { fromPlace: 'Alpha', toPlace: 'Beta', oneWayKm: 30, travelMode: 'bike', category: 'EX' },
          {
            fromPlace: 'Alpha',
            toPlace: 'Metro',
            oneWayKm: 102,
            actualFare: true,
            travelMode: 'bus_train',
            category: 'MEETING',
            da: 150,
          },
        ],
      });
    expect(put.status).toBe(200);
    const t1 = SfcTable.parse(put.body);
    expect(
      t1.routes.map((r) => [r.sortOrder, r.bothWayKm, r.oneWayAmount, r.bothWayAmount]),
    ).toEqual([
      [1, 0, 0, 0],
      [2, 60, 88.5, 177],
      [3, 204, null, null],
    ]);
    expect(t1.routes[2]!.da).toBe(150);
    expect(t1.etag).not.toBe(t0.etag);

    const mine = await http().get(url(U.rep)).set(as('bm'));
    expect(mine.status).toBe(200);
    expect(mine.body.canEdit).toBe(false);
    const w = await http()
      .put(url(U.rep))
      .set(as('bm'))
      .send({ etag: t1.etag, hqTerritoryId: T.hq, routes: [] });
    expect(w.status).toBe(403);

    const audit = await owner.query(
      `select count(*)::int n from audit_log where action = 'sfc.routes_saved' and entity_id = $1`,
      [U.rep],
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it('stale etag gives 409 VERSION_CONFLICT; edit keeps ids; missing rows are deleted', async () => {
    const t = SfcTable.parse((await http().get(url(U.rep)).set(as('director'))).body);
    const stale = await http()
      .put(url(U.rep))
      .set(as('director'))
      .send({ etag: 'old', hqTerritoryId: T.hq, routes: [] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details.etag).toBe(t.etag);
    const keep = t.routes[1]!;
    const r = await http()
      .put(url(U.rep))
      .set(as('director'))
      .send({
        etag: t.etag,
        hqTerritoryId: T.hq,
        routes: [{ ...keep, oneWayKm: 31 }],
      });
    expect(r.status).toBe(200);
    expect(r.body.routes).toHaveLength(1);
    expect(r.body.routes[0].id).toBe(keep.id);
    expect(r.body.routes[0].oneWayAmount).toBe(91.45);
    const again = await http()
      .put(url(U.rep))
      .set(as('director'))
      .send({ etag: t.etag, hqTerritoryId: T.hq, routes: [] });
    expect(again.status).toBe(409);
  });

  it('validation: HQ must be assigned, ids must be live rows, travel mode known', async () => {
    const t = SfcTable.parse((await http().get(url(U.rep)).set(as('abm'))).body);
    const hq = await http()
      .put(url(U.rep))
      .set(as('abm'))
      .send({ etag: t.etag, hqTerritoryId: T.otherArea, routes: [] });
    expect(hq.status).toBe(422);
    expect(hq.body.error.code).toBe('SFC_HQ_NOT_ASSIGNED');
    const bad = await http()
      .put(url(U.rep))
      .set(as('abm'))
      .send({
        etag: t.etag,
        hqTerritoryId: T.hq,
        routes: [{ id: U.rep, fromPlace: 'X', toPlace: 'Y', oneWayKm: 1 }],
      });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('SFC_ROUTE_NOT_FOUND');
    const mode = await http()
      .put(url(U.rep))
      .set(as('abm'))
      .send({
        etag: t.etag,
        hqTerritoryId: T.hq,
        routes: [{ fromPlace: 'X', toPlace: 'Y', oneWayKm: 1, travelMode: 'plane' }],
      });
    expect(mode.status).toBe(422);
  });

  it('scope: ABM cannot see a BM outside the reporting line; cannot edit own table', async () => {
    expect((await http().get(url(U.otherRep)).set(as('abm'))).status).toBe(404);
    const own = await http().get(url(U.area)).set(as('abm'));
    expect(own.status).toBe(200);
    expect(own.body.canEdit).toBe(false);
    expect((await http().get(url(U.rep)).set(as('bm2'))).status).toBe(404);
    expect((await http().get(url(U.rep)).set(as('accountant'))).status).toBe(403);
  });

  it('scope: EITHER mechanism covers a BM (territory tree without managerId, or reporting line)', async () => {
    // BM on the ABM's HQ but reporting straight to the RBM: covered by the ABM's territory only.
    const bm = await insertStaff('sfc-terr-bm@example.test', 'business_manager', U.regional, [
      T.hq,
    ]);
    const g = await http().get(url(bm.id)).set(as('abm'));
    expect(g.status).toBe(200);
    expect(g.body.canEdit).toBe(true);
    const put = await http()
      .put(url(bm.id))
      .set(as('abm'))
      .send({ etag: g.body.etag, hqTerritoryId: T.hq, routes: [] });
    expect(put.status).toBe(200);
    // A peer ABM on the same area is not covered (rank must be strictly lower).
    const peer = await insertStaff(
      'sfc-peer-abm@example.test',
      'area_business_manager',
      U.regional,
      [T.area],
    );
    expect((await http().get(url(peer.id)).set(as('abm'))).status).toBe(404);
  });

  it('system_admin edits any table; director lists HQs and employees company-wide', async () => {
    const t = SfcTable.parse((await http().get(url(U.otherRep)).set(as('sysadmin'))).body);
    expect(t.canEdit).toBe(true);
    const hqs = SfcHqList.parse((await http().get('/v1/sfc/hqs').set(as('director'))).body);
    const hq = hqs.items.find((h) => h.id === T.hq);
    expect(hq?.level).toBe('headquarter');
    expect(hq?.routeCount).toBeGreaterThan(0);
    const abmHqs = SfcHqList.parse((await http().get('/v1/sfc/hqs').set(as('abm'))).body);
    expect(abmHqs.items.map((h) => h.id)).toContain(T.hq);
    const emp = SfcEmployeeList.parse(
      (await http().get(`/v1/sfc/employees?territoryId=${T.area}`).set(as('abm'))).body,
    );
    const rep = emp.items.find((e) => e.id === U.rep);
    expect(rep?.hasSfc).toBe(true);
    expect(rep?.canEdit).toBe(true);
    expect(emp.items.some((e) => e.id === U.otherRep)).toBe(false);
  });

  it('rate change: settings:write only, version checked', async () => {
    const s = (await http().get('/v1/sfc/settings').set(as('director'))).body;
    expect((await http().put('/v1/sfc/settings').set(as('abm')).send(s)).status).toBe(403);
    const ok = await http()
      .put('/v1/sfc/settings')
      .set(as('director'))
      .send({ ratePerKm: 3, version: s.version });
    expect(ok.status).toBe(200);
    expect((await http().put('/v1/sfc/settings').set(as('director')).send(s)).status).toBe(409);
    await http()
      .put('/v1/sfc/settings')
      .set(as('director'))
      .send({ ratePerKm: 2.95, version: ok.body.version });
  });
});
