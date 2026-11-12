import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ensureFieldReady, insertStaff } from './support';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const id7 = () => {
  const h = Date.now().toString(16).padStart(12, '0');
  const r = randomUUID().replace(/-/g, '');
  return `${h.slice(0, 8)}-${h.slice(8)}-7${r.slice(13, 16)}-8${r.slice(17, 20)}-${r.slice(20, 32)}`;
};
const HOME = { lat: 22.57, lng: 88.36 };
const FAR = { lat: 22.6, lng: 88.36 }; // ~3.3 km
const RUN = Date.now().toString(36);
/** Company DCR day is Asia/Kolkata — never use UTC `toISOString().slice(0,10)`. */
const istToday = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);

describe.skipIf(!OWNER || !APP)('outlet locations + presentation hard gate', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  const cap = (extra: object) => ({
    clientId: id7(),
    location: HOME,
    accuracyM: 15,
    capturedAt: new Date().toISOString(),
    isMock: false,
    ...extra,
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['sysadmin', 'director', 'bm', 'abm']) {
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

  async function enrolBmDevice() {
    const me = await http().get('/v1/me/consent').set(as('bm'));
    if (me.body.canCheckIn) return me.body.deviceId as string;
    const dev = await http()
      .post('/v1/devices')
      .set(as('bm'))
      .send({
        ownership: 'personal',
        platform: 'android',
        installId: `lock-${randomUUID()}`,
        model: 'Pixel',
        osVersion: '15',
        appVersion: '0.1.0',
        assetTag: null,
      });
    expect(dev.status).toBe(201);
    for (const purpose of ['personal_device_enrolment', 'location_checkin']) {
      expect(
        (
          await http()
            .post(`/v1/devices/${dev.body.id}/consents`)
            .set(as('bm'))
            .send({ purpose, granted: true, noticeVersion: '2026-10-v1' })
        ).status,
      ).toBe(201);
    }
    return dev.body.id as string;
  }

  async function makeDoctor(name: string, withLocation = false) {
    const res = await http()
      .post('/v1/doctors')
      .set(as('director'))
      .send({
        territoryId: T.hq,
        name,
        location: withLocation ? HOME : null,
        ...Object.fromEntries(
          [
            'qualification',
            'specialtyId',
            'categoryId',
            'registrationNo',
            'addressLine',
            'city',
            'state',
            'pincode',
            'phone',
          ].map((k) => [k, null]),
        ),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  }

  it('locks a doctor location; chem second active rejected; BM cannot patch; ABM can', async () => {
    await enrolBmDevice();
    const docId = await makeDoctor(`Dr Lock ${RUN}`);
    const empty = await http().get(`/v1/outlets/doctor/${docId}/locations`).set(as('bm'));
    expect(empty.body.items).toHaveLength(0);

    const blurry = await http()
      .post(`/v1/outlets/doctor/${docId}/locations`)
      .set(as('bm'))
      .send(cap({ label: 'clinic', accuracyM: 200 }));
    expect(blurry.status).toBe(422);
    expect(blurry.body.error.code).toBe('LOW_ACCURACY');

    const lockBody = cap({ label: 'clinic' });
    const lock = await http()
      .post(`/v1/outlets/doctor/${docId}/locations`)
      .set(as('bm'))
      .send(lockBody);
    expect(lock.status, JSON.stringify(lock.body)).toBe(201);
    expect(lock.body).toMatchObject({
      outletKind: 'doctor',
      outletId: docId,
      label: 'clinic',
      active: true,
    });
    const replay = await http()
      .post(`/v1/outlets/doctor/${docId}/locations`)
      .set(as('bm'))
      .send(lockBody);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(lock.body.id);

    const second = await http()
      .post(`/v1/outlets/doctor/${docId}/locations`)
      .set(as('bm'))
      .send(cap({ label: 'hospital', location: { lat: 22.571, lng: 88.361 } }));
    expect(second.status).toBe(201);
    const listed = await http().get(`/v1/outlets/doctor/${docId}/locations`).set(as('bm'));
    expect(listed.body.items.length).toBeGreaterThanOrEqual(2);

    const chem = await http()
      .post('/v1/chemists')
      .set(as('director'))
      .send({
        territoryId: T.hq,
        name: `Chem Lock ${RUN}`,
        location: null,
        gstin: null,
        drugLicenseNo: null,
        addressLine: null,
        city: null,
        state: null,
        pincode: null,
        phone: null,
      });
    expect(chem.status, JSON.stringify(chem.body)).toBe(201);
    const c1 = await http()
      .post(`/v1/outlets/chemist/${chem.body.id}/locations`)
      .set(as('bm'))
      .send(cap({ label: 'retail_shop' }));
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    const c2 = await http()
      .post(`/v1/outlets/chemist/${chem.body.id}/locations`)
      .set(as('bm'))
      .send(cap({ label: 'distributor_counter' }));
    expect(c2.status).toBe(409);
    expect(c2.body.error.code).toBe('LOCATION_EXISTS');

    const bmPatch = await http()
      .patch(`/v1/outlet-locations/${lock.body.id}`)
      .set(as('bm'))
      .send({ version: lock.body.version, label: 'chamber' });
    expect(bmPatch.status).toBe(403);

    const abmPatch = await http()
      .patch(`/v1/outlet-locations/${lock.body.id}`)
      .set(as('abm'))
      .send({ version: lock.body.version, label: 'chamber' });
    expect(abmPatch.status, JSON.stringify(abmPatch.body)).toBe(200);
    expect(abmPatch.body.label).toBe('chamber');
  });

  it('a doctor cannot have a sixth active lock', async () => {
    await enrolBmDevice();
    const docId = await makeDoctor(`Dr Five ${RUN}`);
    for (let i = 0; i < 5; i++) {
      const ok = await http()
        .post(`/v1/outlets/doctor/${docId}/locations`)
        .set(as('bm'))
        .send(
          cap({
            label: i === 0 ? 'clinic' : 'chamber',
            location: { lat: HOME.lat + i * 0.01, lng: HOME.lng },
          }),
        );
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    }
    const sixth = await http()
      .post(`/v1/outlets/doctor/${docId}/locations`)
      .set(as('bm'))
      .send(cap({ label: 'chamber', location: { lat: HOME.lat + 0.06, lng: HOME.lng } }));
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.code).toBe('LOCATION_LIMIT');
  });

  it('presentation hard-blocks without lock / outside 300m; allows in fence', async () => {
    // Own BM so seed-bm DCR submits in other files cannot 409 DAY_ALREADY_SUBMITTED.
    const staff = await insertStaff(`outlet-pres-${RUN}@example.test`, 'business_manager', U.area, [
      T.hq,
    ]);
    tok.pres = staff.bearer;
    await ensureFieldReady(http, tok.pres);

    const g = await http().get('/v1/settings/geofence').set(as('director'));
    expect(g.body.presentationRadiusM).toBe(300);
    expect(g.body.lockMaxAccuracyM).toBe(80);

    const today = istToday();
    const opt = await http().get(`/v1/dcrs/options?date=${today}`).set(as('pres'));
    expect(opt.status, JSON.stringify(opt.body)).toBe(200);
    const workTypeId = (opt.body.workTypes as { id: string; kind: string; code: string }[]).find(
      (w) => w.kind === 'field' && w.code.startsWith('FIELD_'),
    )?.id;
    expect(workTypeId).toBeTruthy();

    const docId = await makeDoctor(`Dr Pres ${RUN}`);
    const draftCall = (extra: object) => ({
      clientId: id7(),
      outletKind: 'doctor' as const,
      outletId: docId,
      checkInId: null as string | null,
      jointWorkUserIds: [],
      productsDetailed: [],
      samples: [],
      pob: [],
      rcpa: [],
      remarks: null,
      presentationOpenedAt: new Date().toISOString(),
      ...extra,
    });
    const draft = (calls: object[]) =>
      http()
        .put('/v1/dcrs/draft')
        .set(as('pres'))
        .send({ date: today, workTypeId, territoryIds: [T.hq], calls });

    const noCheckIn = await draft([draftCall({ presentationCapture: cap({}) })]);
    expect(noCheckIn.status, JSON.stringify(noCheckIn.body)).toBe(422);
    expect(noCheckIn.body.error.code).toBe('CALL_NOT_CHECKED_IN');

    const lock = await http()
      .post(`/v1/outlets/doctor/${docId}/locations`)
      .set(as('pres'))
      .send(cap({ label: 'clinic' }));
    expect(lock.status, JSON.stringify(lock.body)).toBe(201);

    const visit = await http()
      .post('/v1/check-ins')
      .set(as('pres'))
      .send(cap({ kind: 'visit', outletKind: 'doctor', outletId: docId }));
    expect([200, 201]).toContain(visit.status);
    const checkInId = visit.body.id as string;

    const far = await draft([
      draftCall({ checkInId, presentationCapture: cap({ location: FAR }) }),
    ]);
    expect(far.status, JSON.stringify(far.body)).toBe(422);
    expect(far.body.error.code).toBe('PRESENTATION_OUT_OF_FENCE');

    const ok = await draft([
      draftCall({
        checkInId,
        presentationCapture: cap({ location: { lat: 22.5705, lng: 88.36 } }),
      }),
    ]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const call = ok.body.calls?.[0];
    expect(call?.presentationLocationId).toBeTruthy();
    expect(call?.presentationDistanceM).toBeLessThanOrEqual(300);
  });
});
