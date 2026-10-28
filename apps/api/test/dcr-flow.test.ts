import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID as A, T, U } from '@ariforce/db';
import { Dcr, DcrOptions, DcrSfcMatch } from '@ariforce/contracts';
import { insertStaff } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);

describe.skipIf(!OWNER || !APP)('DCR redesign flow (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  let me: { id: string; bearer: string };
  let hq2: string;
  let doctorId: string;
  const wt: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = () => ({ authorization: me.bearer });
  const today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const route = async (hq: string, cat: string, to: string) => {
    const id = randomUUID();
    await owner.query(
      `insert into sfc_routes (id, company_id, user_id, hq_territory_id, from_place, to_place,
         one_way_km, both_way_km, one_way_amount, both_way_amount, travel_mode, category, da)
       values ($1,$2,$3,$4,'Base',$5,10,20,29.5,59,'bike',$6,150)`,
      [id, A, me.id, hq, to, cat],
    );
    return id;
  };
  const call = () => ({
    clientId: randomUUID(),
    outletKind: 'doctor',
    outletId: doctorId,
    checkInId: null,
    jointWorkUserIds: [],
    productsDetailed: [],
    samples: [],
    pob: [],
    rcpa: [],
    remarks: null,
    calledAt: new Date().toISOString(),
  });
  let r1: string, r2: string, r3: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    const h = await owner.query(
      `select id from territories where company_id=$1 and level='headquarter' and id <> $2 and deleted_at is null limit 1`,
      [A, T.hq],
    );
    hq2 = h.rows[0].id;
    me = await insertStaff(`dcr-flow-${RUN}@example.test`, 'business_manager', U.regional, [
      T.hq,
      hq2,
    ]);
    const d = await owner.query(
      `select id from doctors where company_id=$1 and territory_id=$2 and deleted_at is null limit 1`,
      [A, T.hq],
    );
    doctorId = d.rows[0].id;
    const w = await owner.query(
      `select id, code from work_types where company_id=$1 and code in ('FIELD_HQ','MEETING','LEAVE')`,
      [A],
    );
    for (const x of w.rows) wt[x.code] = x.id;
    r1 = await route(T.hq, 'hq', 'Alpha');
    r2 = await route(T.hq, 'hq', 'Beta');
    r3 = await route(hq2, 'hq', 'Gamma');
    await route(hq2, 'ex', 'Delta'); // other band: never a candidate
  });
  afterAll(async () => {
    if (me) {
      await owner.query(
        `delete from dcr_sfc_routes where dcr_id in (select id from dcrs where user_id=$1)`,
        [me.id],
      );
      await owner.query(
        `delete from dcr_calls where dcr_id in (select id from dcrs where user_id=$1)`,
        [me.id],
      );
      await owner.query(`delete from dcrs where user_id=$1`, [me.id]);
      await owner.query(`delete from sfc_routes where user_id=$1`, [me.id]);
    }
    await owner?.end();
    await app?.close();
  });

  it('options lists work types with band and details kind', async () => {
    const r = await http().get(`/v1/dcrs/options?date=${today}`).set(as());
    expect(r.status).toBe(200);
    const o = DcrOptions.parse(r.body);
    expect(o.workTypes.find((x) => x.code === 'FIELD_HQ')).toMatchObject({
      band: 'hq',
      usesSfc: true,
    });
    expect(o.workTypes.find((x) => x.code === 'MEETING')).toMatchObject({
      detailsKind: 'meeting',
      usesSfc: false,
    });
  });

  it('sfc-match returns one entry per HQ, band-filtered', async () => {
    const r = await http()
      .get(`/v1/dcrs/sfc-match?date=${today}&workTypeId=${wt.FIELD_HQ}&territoryIds=${T.hq},${hq2}`)
      .set(as());
    expect(r.status).toBe(200);
    const m = DcrSfcMatch.parse(r.body);
    expect(m.hqs).toHaveLength(2);
    const a = m.hqs.find((x) => x.hqTerritoryId === T.hq)!;
    const b = m.hqs.find((x) => x.hqTerritoryId === hq2)!;
    expect(a.candidates).toHaveLength(2);
    expect(a.autoSelectedId).toBeNull();
    expect(b.candidates.map((c) => c.id)).toEqual([r3]);
    expect(b.autoSelectedId).toBe(r3);
  });

  it('Meeting rejects sfcRoutes', async () => {
    const r = await http()
      .put('/v1/dcrs/draft')
      .set(as())
      .send({
        date: today,
        workTypeId: wt.MEETING,
        sfcRoutes: [{ hqTerritoryId: T.hq, sfcRouteId: r1 }],
      });
    expect(r.status).toBe(422);
  });

  let id = '';
  let version = 0;
  it('multi-HQ draft, SFC_ROUTE_REQUIRED, then submit freezes snapshots; same-key retry', async () => {
    let r = await http()
      .put('/v1/dcrs/draft')
      .set(as())
      .send({
        date: today,
        workTypeId: wt.FIELD_HQ,
        territoryIds: [T.hq, hq2],
        deviationReason: 'test',
        calls: [call()],
      });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    let d = Dcr.parse(r.body);
    id = d.id;
    r = await http()
      .post(`/v1/dcrs/${id}/submit`)
      .set(as())
      .set('idempotency-key', `k-${RUN}`)
      .send({ version: d.version });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('SFC_ROUTE_REQUIRED');
    r = await http()
      .put('/v1/dcrs/draft')
      .set(as())
      .send({
        date: today,
        workTypeId: wt.FIELD_HQ,
        territoryIds: [T.hq, hq2],
        deviationReason: 'test',
        sfcRoutes: [{ hqTerritoryId: T.hq, sfcRouteId: r2 }],
        calls: [call()],
        version: d.version,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    d = Dcr.parse(r.body);
    r = await http()
      .post(`/v1/dcrs/${id}/submit`)
      .set(as())
      .set('idempotency-key', `k-${RUN}`)
      .send({ version: d.version });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = Dcr.parse(r.body);
    expect(s.status).toBe('submitted');
    expect(s.sfcRoutes).toHaveLength(2);
    const byHq = Object.fromEntries(s.sfcRoutes.map((x) => [x.hqTerritoryId, x]));
    expect(byHq[T.hq]!.sfcRouteId).toBe(r2);
    expect(byHq[hq2]!.sfcRouteId).toBe(r3);
    expect(byHq[T.hq]!.snapshot).toMatchObject({ toPlace: 'Beta', category: 'hq', band: 'hq' });
    version = s.version;
    const again = await http()
      .post(`/v1/dcrs/${id}/submit`)
      .set(as())
      .set('idempotency-key', `k-${RUN}`)
      .send({ version: d.version });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);
  });

  it('after submit: other key 409, draft 409 ALREADY_SUBMITTED, old PUT 409', async () => {
    const k = await http()
      .post(`/v1/dcrs/${id}/submit`)
      .set(as())
      .set('idempotency-key', `other-${RUN}`)
      .send({ version });
    expect(k.status).toBe(409);
    const d = await http()
      .put('/v1/dcrs/draft')
      .set(as())
      .send({ date: today, workTypeId: wt.FIELD_HQ, territoryIds: [T.hq] });
    expect(d.status).toBe(409);
    expect(d.body.error.code).toBe('ALREADY_SUBMITTED');
    const o = await http()
      .put('/v1/dcrs')
      .set(as())
      .send({ date: today, workTypeId: wt.FIELD_HQ, territoryIds: [T.hq], calls: [] });
    expect(o.status).toBe(409);
  });

  it('leave without a leave request: LEAVE_NOT_FOUND', async () => {
    const day = new Date(Date.now() + 5.5 * 36e5 - 864e5).toISOString().slice(0, 10);
    const r = await http()
      .put('/v1/dcrs/draft')
      .set(as())
      .send({
        date: day,
        workTypeId: wt.LEAVE,
        details: { kind: 'leave', leaveRequestId: randomUUID() },
      });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = await http()
      .post(`/v1/dcrs/${r.body.id}/submit`)
      .set(as())
      .set('idempotency-key', `leave-${RUN}`)
      .send({ version: r.body.version });
    expect(s.status).toBe(422);
    expect(s.body.error.code).toBe('LEAVE_NOT_FOUND');
  });
});
