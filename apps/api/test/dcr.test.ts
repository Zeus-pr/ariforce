import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthDates } from '@ariforce/contracts';
import { T } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ensureProduct } from './support';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const ist = (d: Date) => new Date(d.getTime() + 5.5 * 36e5).toISOString().slice(0, 10);
const TODAY = ist(new Date());
const OLD = ist(new Date(Date.now() - 10 * 864e5));
const M = TODAY.slice(0, 7);
const NEW_DOCTOR = {
  qualification: null,
  specialtyId: null,
  categoryId: null,
  registrationNo: null,
  addressLine: null,
  city: null,
  state: null,
  pincode: null,
  location: null,
  phone: null,
};

describe.skipIf(!OWNER || !APP)('DCR (real API)', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let field: string, leave: string, doctor: string, product: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['bm', 'abm', 'director', 'rbm', 'zbm', 'bm2']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
    const wt = (await http().get('/v1/work-types?limit=50').set(as('bm'))).body.items;
    field = wt.find((w: { kind: string }) => w.kind === 'field').id;
    leave = wt.find((w: { kind: string }) => w.kind !== 'field').id;
    doctor = (await http().get('/v1/doctors?approvalStatus=approved&limit=1').set(as('bm'))).body
      .items[0].id;
    product = await ensureProduct(http, tok.bm!, tok.director!);
    // Approved tour plan for this month: field work in T.hq every day.
    const entry = { session: 'full', workTypeId: field, territoryIds: [T.hq] };
    const days = monthDates(M).map((date) => ({ date, entries: [entry] }));
    expect((await http().put(`/v1/tour-plans/${M}`).set(as('bm')).send({ days })).status).toBe(200);
    expect((await http().post(`/v1/tour-plans/${M}/submit`).set(as('bm'))).status).toBe(200);
    const q = (await http().get('/v1/approvals?mine=to_decide').set(as('abm'))).body.items;
    const tp = q.find((a: { summary: string }) => a.summary === `Tour plan ${M}`);
    expect(
      (
        await http()
          .post(`/v1/approvals/${tp.id}/decision`)
          .set(as('abm'))
          .send({ decision: 'approve' })
      ).status,
    ).toBe(200);
  });
  afterAll(async () => {
    await app?.close();
  });

  const call = (over: Record<string, unknown> = {}) => ({
    clientId: uuidv7(),
    outletKind: 'doctor',
    outletId: doctor,
    jointWorkUserIds: [],
    productsDetailed: [{ productId: product, order: 1 }],
    samples: [{ productId: product, quantity: 2 }],
    pob: [],
    checkInId: null,
    remarks: null,
    presentationOpenedAt: new Date().toISOString(),
    calledAt: new Date().toISOString(),
    ...over,
  });

  it('links the approved tour plan, allows deviations without a reason, validates calls', async () => {
    const future = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({ date: '2099-01-01', workTypeId: field, territoryIds: [T.hq], calls: [] });
    expect(future.status).toBe(422);
    const dev = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({ date: TODAY, workTypeId: leave, territoryIds: [], calls: [] });
    expect(dev.status, JSON.stringify(dev.body)).toBe(200);
    const callsOnLeave = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({
        date: TODAY,
        workTypeId: leave,
        territoryIds: [],
        calls: [call()],
        deviationReason: 'x',
      });
    expect(callsOnLeave.status).toBe(422);
    const badProduct = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({
        date: TODAY,
        workTypeId: field,
        territoryIds: [T.hq],
        calls: [call({ samples: [{ productId: uuidv7(), quantity: 1 }] })],
      });
    expect(badProduct.status).toBe(422);
    // #26: a rejected field-added doctor cannot be reported.
    const tag = uuidv7().slice(-6);
    const added = await http()
      .post('/v1/doctors')
      .set(as('rbm'))
      .send({ ...NEW_DOCTOR, name: `Dr. Rejected ${tag}`, territoryId: T.hq });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const ask = (
      await http().get('/v1/approvals?mine=to_decide&subjectType=doctor').set(as('zbm'))
    ).body.items.find((a: { subjectId: string }) => a.subjectId === added.body.id);
    expect(
      (
        await http()
          .post(`/v1/approvals/${ask.id}/decision`)
          .set(as('zbm'))
          .send({ decision: 'reject', comment: 'not in this HQ' })
      ).status,
    ).toBe(200);
    const rejectedCall = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({
        date: TODAY,
        workTypeId: field,
        territoryIds: [T.hq],
        calls: [call({ outletId: added.body.id })],
      });
    expect(rejectedCall.status).toBe(422);
    expect(rejectedCall.body.error.details.doctorIds).toEqual([added.body.id]);
    const emptySubmit = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({ date: TODAY, workTypeId: field, territoryIds: [T.hq], calls: [], submit: true });
    expect(emptySubmit.status).toBe(422);

    const c = call({ jointWorkUserIds: [] });
    const ok = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({ date: TODAY, workTypeId: field, territoryIds: [T.hq], calls: [c] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'draft', deviationReason: null, territoryIds: [T.hq] });
    expect(ok.body.tourPlanId).toEqual(expect.any(String));
    expect(ok.body.calls).toHaveLength(1);
    expect(ok.body.calls[0]).toMatchObject({
      id: c.clientId,
      samples: [{ productId: product, quantity: 2 }],
    });

    // Idempotent resend + submit; dropping a call soft-deletes it.
    const c2 = call();
    const sub = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({
        date: TODAY,
        workTypeId: field,
        territoryIds: [T.hq],
        calls: [c2],
        submit: true,
        version: ok.body.version,
      });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.status).toBe('submitted');
    expect(sub.body.calls.map((x: { id: string }) => x.id)).toEqual([c2.clientId]);
    const stale = await http()
      .put('/v1/dcrs')
      .set(as('bm'))
      .send({
        date: TODAY,
        workTypeId: field,
        territoryIds: [T.hq],
        calls: [c2],
        version: ok.body.version,
      });
    expect(stale.status).toBe(409);

    const mgr = await http().get(`/v1/dcrs?from=${TODAY}&to=${TODAY}`).set(as('abm'));
    expect(mgr.body.items.map((d: { id: string }) => d.id)).toContain(sub.body.id);
    // Doctor 360: doctorId + limit, same reporting-line scope.
    const ids = (r: request.Response) => r.body.items.map((d: { id: string }) => d.id);
    const d360 = await http().get(`/v1/dcrs?doctorId=${doctor}&limit=100`).set(as('abm'));
    expect(d360.status).toBe(200);
    expect(ids(d360)).toContain(sub.body.id);
    const one = await http().get(`/v1/dcrs?doctorId=${doctor}&limit=1`).set(as('abm'));
    expect(one.body.items.length).toBeLessThanOrEqual(1);
    expect(ids(await http().get(`/v1/dcrs?doctorId=${T.hq}`).set(as('abm')))).not.toContain(
      sub.body.id,
    );
    // A BM outside the line sees none of it, even when naming the other BM (no dcr:review = own only).
    expect(ids(await http().get(`/v1/dcrs?doctorId=${doctor}`).set(as('bm2')))).not.toContain(
      sub.body.id,
    );
    const peer = await http()
      .get(`/v1/dcrs?doctorId=${doctor}&userId=${sub.body.userId}`)
      .set(as('bm2'));
    expect(peer.status).toBe(200);
    expect(ids(peer)).not.toContain(sub.body.id);
    expect((await http().get(`/v1/dcrs/${sub.body.id}`).set(as('abm'))).status).toBe(200);
    expect(
      (
        await http()
          .put('/v1/dcrs')
          .set(as('abm'))
          .send({ date: TODAY, workTypeId: field, territoryIds: [T.hq], calls: [] })
      ).status,
    ).toBe(200);
  });

  it('locks old days; correction request + approval unlocks for 48h (gap #8)', async () => {
    const body = {
      date: OLD,
      workTypeId: leave,
      territoryIds: [],
      calls: [],
      deviationReason: 'Was on leave',
    };
    const locked = await http().put('/v1/dcrs').set(as('bm')).send(body);
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('DAY_LOCKED');
    const notLocked = await http()
      .post('/v1/dcrs/correction-requests')
      .set(as('bm'))
      .send({ date: TODAY, reason: 'nothing' });
    expect(notLocked.status).toBe(409);
    const req = await http()
      .post('/v1/dcrs/correction-requests')
      .set(as('bm'))
      .send({ date: OLD, reason: 'Forgot to file' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body).toMatchObject({ status: 'pending', subjectType: 'dcr_unlock' });
    expect(
      (
        await http()
          .post(`/v1/approvals/${req.body.id}/decision`)
          .set(as('director'))
          .send({ decision: 'approve' })
      ).status,
    ).toBe(200);
    const saved = await http().put('/v1/dcrs').set(as('bm')).send(body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.unlockedUntil).toEqual(expect.any(String));
    const lockedList = await http().get(`/v1/dcrs?status=locked`).set(as('bm'));
    expect(lockedList.status).toBe(200);
  });
});
