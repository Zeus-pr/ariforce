import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const TAG = uuidv7().slice(-6).toUpperCase();
const PIN = `7${String(Date.now()).slice(-5)}`;
const body = (over: Record<string, unknown> = {}) => ({
  territoryId: T.hq,
  name: `Dr. Field Added ${TAG}`,
  qualification: 'MBBS',
  specialtyId: null,
  categoryId: null,
  registrationNo: `TEST-${TAG}`,
  addressLine: null,
  city: null,
  state: null,
  pincode: PIN,
  location: null,
  phone: null,
  ...over,
});

// #26 field-added (RBM..VP: scoped roles with masters:write; BM/ABM are read-only on masters) doctor approval + duplicate detection (docs/DOCTOR-APPROVAL.md). Needs the SSD test DB.
describe.skipIf(!OWNER || !APP)('doctor approval + duplicates (real API)', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  const queue = async (who: string, id: string) =>
    (
      await http().get('/v1/approvals?mine=to_decide&subjectType=doctor&limit=100').set(as(who))
    ).body.items.find((a: { subjectId: string }) => a.subjectId === id);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['rbm', 'zbm', 'director', 'bm']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      expect(res.status).toBe(200);
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  let pendingId = '';

  it('BM/ABM cannot add doctors (masters read-only) but may run the duplicate check', async () => {
    expect((await http().post('/v1/doctors').set(as('bm')).send(body())).status).toBe(403);
    const chk = await http()
      .post('/v1/doctors/duplicate-check')
      .set(as('bm'))
      .send({ name: 'Dr. A. Sen' });
    expect(chk.status).toBe(200);
  });

  it('field user adds a pending doctor with an approval request to the manager', async () => {
    const res = await http().post('/v1/doctors').set(as('rbm')).send(body());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.approvalStatus).toBe('pending');
    expect(res.body).not.toHaveProperty('allowPossibleDuplicate');
    pendingId = res.body.id;
    const req = await queue('zbm', pendingId);
    expect(req).toMatchObject({
      subjectType: 'doctor',
      status: 'pending',
      summary: `New doctor Dr. Field Added ${TAG}`,
    });
    expect(await queue('rbm', pendingId)).toBeUndefined();
    const pending = await http().get(`/v1/doctors?approvalStatus=pending&q=${TAG}`).set(as('rbm'));
    expect(pending.body.items.map((d: { id: string }) => d.id)).toEqual([pendingId]);
  });

  it('director adds approved doctors without a request', async () => {
    const res = await http()
      .post('/v1/doctors')
      .set(as('director'))
      .send(body({ name: `Dr. Director ${TAG}`, registrationNo: null, pincode: null }));
    expect(res.status).toBe(201);
    expect(res.body.approvalStatus).toBe('approved');
    expect(await queue('zbm', res.body.id)).toBeUndefined();
  });

  it('refuses a registration-number duplicate, even with the override', async () => {
    const res = await http()
      .post('/v1/doctors')
      .set(as('director'))
      .send(
        body({
          name: 'Dr. Someone Else',
          registrationNo: ` test-${TAG.toLowerCase()}`.trim(),
          allowPossibleDuplicate: true,
        }),
      );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DOCTOR_DUPLICATE');
    expect(res.body.error.details.matches[0]).toEqual({
      id: pendingId,
      name: `Dr. Field Added ${TAG}`,
      territoryId: T.hq,
      territoryName: expect.any(String),
      rule: 'registration_no',
      approvalStatus: 'pending',
    });
  });

  it('warns on name + pincode, creates with allowPossibleDuplicate', async () => {
    const dup = body({ name: `field added ${TAG}`, registrationNo: null });
    const warn = await http().post('/v1/doctors').set(as('rbm')).send(dup);
    expect(warn.status).toBe(409);
    expect(warn.body.error.code).toBe('DOCTOR_POSSIBLE_DUPLICATE');
    expect(warn.body.error.details.matches.map((m: { rule: string }) => m.rule)).toEqual([
      'name_pincode',
    ]);
    const ok = await http()
      .post('/v1/doctors')
      .set(as('rbm'))
      .send({ ...dup, allowPossibleDuplicate: true });
    expect(ok.status).toBe(201);
    expect(ok.body.approvalStatus).toBe('pending');
  });

  it('duplicate-check endpoint (read permission) lists matches, strong first', async () => {
    const res = await http()
      .post('/v1/doctors/duplicate-check')
      .set(as('rbm'))
      .send({ name: `Dr Field Added ${TAG}`, pincode: PIN, registrationNo: `TEST-${TAG}` });
    expect(res.status).toBe(200);
    expect(res.body.matches[0]).toMatchObject({ id: pendingId, rule: 'registration_no' });
    expect(res.body.matches.length).toBeGreaterThanOrEqual(2);
    const none = await http()
      .post('/v1/doctors/duplicate-check')
      .set(as('rbm'))
      .send({ name: `Dr. Nobody ${TAG}`, pincode: PIN });
    expect(none.body).toEqual({ matches: [] });
    const bad = await http()
      .post('/v1/doctors/duplicate-check')
      .set(as('rbm'))
      .send({ pincode: '12' });
    expect(bad.status).toBe(422);
  });

  it('manager rejects; owner edit resubmits; manager approves', async () => {
    const r1 = await queue('zbm', pendingId);
    expect(
      (
        await http()
          .post(`/v1/approvals/${r1.id}/decision`)
          .set(as('zbm'))
          .send({ decision: 'reject' })
      ).status,
    ).toBe(422);
    const rej = await http()
      .post(`/v1/approvals/${r1.id}/decision`)
      .set(as('zbm'))
      .send({ decision: 'reject', comment: 'Wrong HQ' });
    expect(rej.status).toBe(200);
    const d1 = await http().get(`/v1/doctors/${pendingId}`).set(as('rbm'));
    expect(d1.body.approvalStatus).toBe('rejected');

    const edit = await http()
      .patch(`/v1/doctors/${pendingId}`)
      .set(as('rbm'))
      .send({ version: d1.body.version, qualification: 'MBBS, MD' });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.approvalStatus).toBe('pending');
    const r2 = await queue('zbm', pendingId);
    expect(r2.id).not.toBe(r1.id);
    expect(r2.summary).toBe(`Doctor resubmitted Dr. Field Added ${TAG}`);
    const ok = await http()
      .post(`/v1/approvals/${r2.id}/decision`)
      .set(as('zbm'))
      .send({ decision: 'approve' });
    expect(ok.status).toBe(200);
    const d2 = await http().get(`/v1/doctors/${pendingId}`).set(as('rbm'));
    expect(d2.body.approvalStatus).toBe('approved');

    // Approved doctors edited by the field stay approved (D6).
    const again = await http()
      .patch(`/v1/doctors/${pendingId}`)
      .set(as('rbm'))
      .send({ version: d2.body.version, city: 'Kolkata' });
    expect(again.body.approvalStatus).toBe('approved');
  });
});
