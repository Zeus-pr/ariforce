import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const id7 = () => {
  // UUIDv7-shaped id (time-ordered prefix) for clientId.
  const h = Date.now().toString(16).padStart(12, '0');
  const r = randomUUID().replace(/-/g, '');
  return `${h.slice(0, 8)}-${h.slice(8)}-7${r.slice(13, 16)}-8${r.slice(17, 20)}-${r.slice(20, 32)}`;
};
const HOME = { lat: 22.57, lng: 88.36 };
const RUN = Date.now().toString(36);
const BM_NAME = `Field BM ${RUN}`;

// Integration against the throwaway SSD Postgres (scripts/test-db.sh). Skipped without a DB.
describe.skipIf(!OWNER || !APP)(
  'field: devices, consent, check-ins, attendance, users (real API)',
  () => {
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
        tok[who === 'bm' ? 'seedbm' : who] = `Bearer ${res.headers['set-auth-token']}`;
      }
      // Devices, consents and check-ins are append-only and "today"-scoped, so the seed BM keeps
      // state across runs on the same DB. Use a brand-new BM (under the seed ABM) for every run.
      const prevSlug = process.env.SIGNUP_COMPANY_SLUG;
      process.env.SIGNUP_COMPANY_SLUG = 'demo';
      const email = `field.${RUN}@example.test`;
      const pw = `field-${RUN}-pass`;
      const req = await http().post('/v1/auth/sign-up-request').send({
        name: BM_NAME,
        email,
        password: pw,
        requestedRole: 'business_manager',
        territoryId: T.hq,
        managerId: U.area,
      });
      if (prevSlug === undefined) delete process.env.SIGNUP_COMPANY_SLUG;
      else process.env.SIGNUP_COMPANY_SLUG = prevSlug;
      expect(req.status, JSON.stringify(req.body)).toBe(202);
      const list = await http().get('/v1/signup-requests').set(as('abm'));
      const sr = list.body.items.find((x: { email: string }) => x.email === email);
      const ok = await http()
        .post(`/v1/signup-requests/${sr.id}/approve`)
        .set(as('abm'))
        .send({ role: 'business_manager', territoryIds: [T.hq], managerId: U.area });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const si = await http().post('/v1/auth/sign-in/email').send({ email, password: pw });
      expect(si.status).toBe(200);
      tok.bm = `Bearer ${si.headers['set-auth-token']}`;
    });
    afterAll(async () => {
      await app?.close();
    });

    it('GET /v1/users is scoped to the reporting line (gap #3)', async () => {
      const bm = await http().get('/v1/users').set(as('seedbm'));
      expect(bm.status, JSON.stringify(bm.body)).toBe(200);
      expect(bm.body.items.map((u: { email: string }) => u.email)).toEqual(['bm@demo.ariforce.in']);
      const abm = await http().get('/v1/users?includeTotal=true').set(as('abm'));
      const emails = abm.body.items.map((u: { email: string }) => u.email);
      expect(emails).toContain('bm@demo.ariforce.in');
      expect(emails).not.toContain('director@demo.ariforce.in');
      const dir = await http().get('/v1/users?role=business_manager').set(as('director'));
      expect(
        dir.body.items.every((u: { roles: string[] }) => u.roles.includes('business_manager')),
      ).toBe(true);
      expect((await http().get('/v1/users?sort=email').set(as('director'))).status).toBe(422);
    });

    it('geofence settings: read for all, write needs settings:write + version', async () => {
      const g = await http().get('/v1/settings/geofence').set(as('bm'));
      expect(g.status).toBe(200);
      expect((await http().put('/v1/settings/geofence').set(as('bm')).send(g.body)).status).toBe(
        403,
      );
      const stale = { ...g.body, version: g.body.version + 5 };
      expect(
        (await http().put('/v1/settings/geofence').set(as('sysadmin')).send(stale)).status,
      ).toBe(409);
      const ok = await http()
        .put('/v1/settings/geofence')
        .set(as('sysadmin'))
        .send({ ...g.body, radiusM: 150 });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ radiusM: 150, version: g.body.version + 1 });
    });

    it('check-in needs an active device + consent, enforces sequence, accuracy, geofence; unlinked visits', async () => {
      const none = await http()
        .post('/v1/check-ins')
        .set(as('bm'))
        .send(cap({ kind: 'punch_in' }));
      expect(none.status).toBe(412);

      const dev = await http()
        .post('/v1/devices')
        .set(as('bm'))
        .send({
          ownership: 'personal',
          platform: 'android',
          installId: `inst-${randomUUID()}`,
          model: 'Pixel',
          osVersion: '15',
          appVersion: '0.1.0',
          assetTag: null,
        });
      expect(dev.status, JSON.stringify(dev.body)).toBe(201);
      expect(dev.body.status).toBe('pending_consent');
      for (const purpose of ['personal_device_enrolment', 'location_checkin']) {
        const c = await http()
          .post(`/v1/devices/${dev.body.id}/consents`)
          .set(as('bm'))
          .send({ purpose, granted: true, noticeVersion: '2026-10-v1' });
        expect(c.status, JSON.stringify(c.body)).toBe(201);
      }
      const st = await http().get('/v1/me/consent').set(as('bm'));
      expect(st.body).toMatchObject({ deviceId: dev.body.id, canCheckIn: true });

      const visitFirst = await http()
        .post('/v1/check-ins')
        .set(as('bm'))
        .send(cap({ kind: 'visit', outletKind: 'doctor', outletId: randomUUID() }));
      expect(visitFirst.status).toBe(409);
      const blurry = await http()
        .post('/v1/check-ins')
        .set(as('bm'))
        .send(cap({ kind: 'punch_in', accuracyM: 900 }));
      expect(blurry.status).toBe(422);

      const pin = cap({ kind: 'punch_in' });
      const p1 = await http().post('/v1/check-ins').set(as('bm')).send(pin);
      expect(p1.status, JSON.stringify(p1.body)).toBe(201);
      const replay = await http().post('/v1/check-ins').set(as('bm')).send(pin);
      expect(replay.status).toBe(200);
      expect(replay.body.id).toBe(p1.body.id);
      expect(
        (
          await http()
            .post('/v1/check-ins')
            .set(as('bm'))
            .send(cap({ kind: 'punch_in' }))
        ).status,
      ).toBe(409);

      const doc = await http()
        .post('/v1/doctors')
        .set(as('director'))
        .send({
          territoryId: T.hq,
          name: `Dr Fence ${Date.now()}`,
          location: HOME,
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
      expect(doc.status, JSON.stringify(doc.body)).toBe(201);
      const near = await http()
        .post('/v1/check-ins')
        .set(as('bm'))
        .send(
          cap({
            kind: 'visit',
            outletKind: 'doctor',
            outletId: doc.body.id,
            location: { lat: 22.5705, lng: 88.36 },
          }),
        );
      expect(near.status, JSON.stringify(near.body)).toBe(201);
      expect(near.body).toMatchObject({ outletId: doc.body.id, inFence: true, territoryId: T.hq });
      expect(near.body.distanceM).toBeGreaterThan(40);
      const far = await http()
        .post('/v1/check-ins')
        .set(as('bm'))
        .send(
          cap({
            kind: 'visit',
            outletKind: 'doctor',
            outletId: doc.body.id,
            location: { lat: 22.6, lng: 88.36 },
          }),
        );
      expect(far.status).toBe(201);
      expect(far.body.inFence).toBe(false);

      const unl = await http()
        .get(`/v1/check-ins?unlinked=true&outletKind=doctor&outletId=${doc.body.id}`)
        .set(as('bm'));
      expect(unl.body.items).toHaveLength(2);
      // Doctor 360: doctorId + limit; a peer BM outside the line sees nothing and gets 403 by userId.
      const d360 = await http().get(`/v1/check-ins?doctorId=${doc.body.id}`).set(as('bm'));
      expect(d360.body.items).toHaveLength(2);
      const one = await http().get(`/v1/check-ins?doctorId=${doc.body.id}&limit=1`).set(as('bm'));
      expect(one.body.items).toHaveLength(1);
      expect(one.body.nextCursor).toBeTruthy();
      expect(
        (await http().get(`/v1/check-ins?doctorId=${doc.body.id}`).set(as('abm'))).body.items,
      ).toHaveLength(2);
      expect(
        (await http().get(`/v1/check-ins?doctorId=${doc.body.id}`).set(as('seedbm'))).body.items,
      ).toHaveLength(0);
      expect(
        (
          await http()
            .get(`/v1/check-ins?doctorId=${doc.body.id}&userId=${p1.body.userId}`)
            .set(as('seedbm'))
        ).status,
      ).toBe(403);
      const abm = await http().get(`/v1/check-ins?userId=${p1.body.userId}`).set(as('abm'));
      expect(abm.body.items.length).toBeGreaterThanOrEqual(3);
      const other = await http().get(`/v1/check-ins?userId=${p1.body.userId}`).set(as('bm'));
      expect(other.status).toBe(200);
      const abmUser = (await http().get('/v1/me').set(as('abm'))).body;
      const forbidden = await http()
        .get(`/v1/check-ins?userId=${abmUser.user?.id ?? abmUser.id}`)
        .set(as('bm'));
      expect(forbidden.status).toBe(403);
    });

    it('attendance: team rows per day, incl. absent', async () => {
      const r = await http().get('/v1/attendance').set(as('abm'));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const bm = r.body.items.find(
        (d: { userName: string; punchIn: unknown }) => d.userName === BM_NAME && d.punchIn,
      );
      expect(bm).toMatchObject({ status: 'incomplete', visits: 2 });
      expect(r.body.items.some((d: { status: string }) => d.status === 'absent')).toBe(true);
      const range = await http()
        .get('/v1/attendance?from=2026-01-01&to=2026-01-03&includeTotal=true')
        .set(as('bm'));
      expect(range.body.total).toBe(3);
      expect(range.body.items.map((d: { status: string }) => d.status)).toEqual([
        'absent',
        'absent',
        'absent',
      ]);
    });
  },
);
