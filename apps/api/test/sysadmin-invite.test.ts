import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
import { FUNCTIONAL_ROLE_KEYS, HIERARCHY_ROLE_KEYS } from '@ariforce/contracts';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const RUN = `sa${Date.now().toString(36)}`;

describe.skipIf(!OWNER || !APP)('System admin invites any role / any territory', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let n = 0;
  const emp = (role: string, over: Record<string, unknown> = {}) => ({
    name: `${RUN} ${role}`,
    email: `${RUN}.${role}.${n++}@demo.ariforce.in`,
    role,
    ...over,
  });
  const post = (who: string, b: object) => http().post('/v1/employees').set(as(who)).send(b);
  const created: Record<string, string> = {};

  beforeAll(async () => {
    process.env.INVITE_RETURN_LINK = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['director', 'abm', 'dh', 'sysadmin']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
  });
  afterAll(async () => {
    delete process.env.INVITE_RETURN_LINK;
    await app?.close();
  });

  it('creates every hierarchy role on a territory outside any ABM subtree, with no manager', async () => {
    for (const role of HIERARCHY_ROLE_KEYS) {
      const res = await post('sysadmin', emp(role, { territoryIds: [T.otherArea] }));
      expect(res.status, `${role} ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.employee).toMatchObject({ role, managerId: null, status: 'invited' });
      expect(res.body.employee.territories[0].id).toBe(T.otherArea);
      created[role] = res.body.employee.id;
    }
  });

  it('creates functional roles and another system admin without territory or manager', async () => {
    for (const role of [...FUNCTIONAL_ROLE_KEYS, 'system_admin'] as const) {
      const res = await post('sysadmin', emp(role));
      expect(res.status, `${role} ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.employee).toMatchObject({ roles: [role], managerId: null, territories: [] });
      created[role] = res.body.employee.id;
    }
    // A functional role may still be given a territory (any in the company).
    expect((await post('sysadmin', emp('accountant', { territoryIds: [T.hq] }))).status).toBe(201);
  });

  it('validation still applies to the system admin', async () => {
    expect((await post('sysadmin', emp('business_manager'))).status).toBe(422);
    expect((await post('sysadmin', emp('accountant', { managerId: U.director }))).status).toBe(422);
    expect(
      (await post('sysadmin', emp('director', { territoryIds: [T.national], managerId: U.vp })))
        .status,
    ).toBe(422);
    const unknown = '00000000-0000-4000-8000-00000000dead';
    expect(
      (await post('sysadmin', emp('business_manager', { territoryIds: [unknown] }))).status,
    ).toBe(403);
    // Manager must outrank the role.
    expect(
      (
        await post(
          'sysadmin',
          emp('zonal_business_manager', { territoryIds: [T.zone], managerId: U.rep }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          'sysadmin',
          emp('business_manager', { territoryIds: [T.otherArea], managerId: U.regional }),
        )
      ).status,
    ).toBe(201);
  });

  it('bulk invite accepts any role for the system admin', async () => {
    const res = await http()
      .post('/v1/employees/invite-bulk')
      .set(as('sysadmin'))
      .send({
        employees: [
          emp('director', { territoryIds: [T.national] }),
          emp('distribution_head'),
          emp('system_admin'),
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'invited',
      'invited',
      'invited',
    ]);
  });

  it('resends invites and edits functional-role employees', async () => {
    for (const role of ['accountant', 'system_admin', 'director']) {
      const re = await http().post(`/v1/employees/${created[role]}/invite`).set(as('sysadmin'));
      expect(re.status, `${role} ${JSON.stringify(re.body)}`).toBe(201);
    }
    const pa = await http()
      .patch(`/v1/employees/${created.accountant}`)
      .set(as('sysadmin'))
      .send({ version: 1, designation: 'Senior Accountant' });
    expect(pa.status, JSON.stringify(pa.body)).toBe(200);
    expect(
      (await http().post(`/v1/employees/${U.sysadmin}/invite`).set(as('sysadmin'))).status,
    ).toBe(403);
  });

  it('non-admin limits are unchanged', async () => {
    for (const role of ['accountant', 'distribution_head', 'system_admin', 'director'])
      expect((await post('abm', emp(role, { territoryIds: [T.hq] }))).status).toBe(403);
    expect(
      (await post('abm', emp('business_manager', { territoryIds: [T.otherArea] }))).status,
    ).toBe(403);
    expect((await post('abm', emp('business_manager'))).status).toBe(422);
    expect((await post('director', emp('accountant'))).status).toBe(403);
    expect((await post('director', emp('director', { territoryIds: [T.national] }))).status).toBe(
      403,
    );
    expect((await post('dh', emp('business_manager', { territoryIds: [T.hq] }))).status).toBe(403);
    expect(
      (await http().post(`/v1/employees/${created.accountant}/invite`).set(as('director'))).status,
    ).toBe(403);
    const ok = await post('abm', emp('business_manager', { territoryIds: [T.hq] }));
    expect(ok.status).toBe(201);
    expect(ok.body.employee.managerId).toBe(U.area);
  });

  it('GET /v1/users is a company-wide picker for the system admin with invite status', async () => {
    const res = await http().get('/v1/users').query({ q: RUN, limit: 100 }).set(as('sysadmin'));
    expect(res.status).toBe(200);
    const acc = res.body.items.find((u: { id: string }) => u.id === created.accountant);
    expect(acc).toMatchObject({
      roles: ['accountant'],
      territoryIds: [],
      managerId: null,
      status: 'invited',
      hasLogin: false,
      inviteStatus: 'pending',
    });
    expect(Date.parse(acc.inviteExpiresAt)).toBeGreaterThan(Date.now());
    const all = await http().get('/v1/users').query({ limit: 200 }).set(as('sysadmin'));
    const ids = all.body.items.map((u: { id: string }) => u.id);
    for (const id of [U.dh, U.accountant, U.director, U.otherRep]) expect(ids).toContain(id);
    expect(all.body.items.find((u: { id: string }) => u.id === U.rep)).toMatchObject({
      email: 'bm@demo.ariforce.in',
      hasLogin: true,
      inviteStatus: 'accepted',
      inviteExpiresAt: null,
    });
    const abm = await http().get('/v1/users').query({ limit: 200 }).set(as('abm'));
    expect(abm.body.items.map((u: { id: string }) => u.id)).not.toContain(U.otherRep);
  });
});
