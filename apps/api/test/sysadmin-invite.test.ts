import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
import { FUNCTIONAL_ROLE_KEYS, HIERARCHY_ROLE_KEYS } from '@ariforce/contracts';
import { bearerFor, insertRetiredHolder, otherHq } from './support';
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
      tok[who] = await bearerFor(http, who, PASSWORD);
    }
  });
  afterAll(async () => {
    delete process.env.INVITE_RETURN_LINK;
    await app?.close();
  });

  it('creates every hierarchy role on a territory outside any ABM subtree, with no manager', async () => {
    const hq2 = await otherHq(http, tok.sysadmin!, T.otherArea);
    for (const role of HIERARCHY_ROLE_KEYS) {
      // A business manager holds headquarter-level territories only (Part 3).
      const where = role === 'business_manager' ? hq2 : T.otherArea;
      const res = await post('sysadmin', emp(role, { territoryIds: [where] }));
      expect(res.status, `${role} ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.employee).toMatchObject({ role, managerId: null, status: 'invited' });
      expect(res.body.employee.territories[0].id).toBe(where);
      created[role] = res.body.employee.id;
    }
  });

  it('retired roles cannot be created (422 ROLE_RETIRED); another system admin can', async () => {
    for (const role of FUNCTIONAL_ROLE_KEYS) {
      for (const over of [{}, { territoryIds: [T.hq] }]) {
        const res = await post('sysadmin', emp(role, over));
        expect(res.status, `${role} ${JSON.stringify(res.body)}`).toBe(422);
        expect(res.body.error.code).toBe('ROLE_RETIRED');
      }
    }
    const res = await post('sysadmin', emp('system_admin'));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.employee).toMatchObject({
      roles: ['system_admin'],
      managerId: null,
      territories: [],
    });
    created.system_admin = res.body.employee.id;
    created.accountant = (
      await insertRetiredHolder(`${RUN}.legacy-acc@demo.ariforce.in`, 'accountant')
    ).id;
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
      ).body.error.code,
    ).toBe('TERRITORY_LEVEL_INVALID');
    expect(
      (
        await post(
          'sysadmin',
          emp('business_manager', {
            territoryIds: [await otherHq(http, tok.sysadmin!, T.otherArea)],
            managerId: U.regional,
          }),
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
      'failed',
      'invited',
    ]);
    expect(res.body.results[1].code).toBe('ROLE_RETIRED');
  });

  it('resends invites; a retired-role holder gets 422 ROLE_RETIRED but can still be edited', async () => {
    for (const role of ['system_admin']) {
      const re = await http().post(`/v1/employees/${created[role]}/invite`).set(as('sysadmin'));
      expect(re.status, `${role} ${JSON.stringify(re.body)}`).toBe(201);
    }
    const re = await http().post(`/v1/employees/${created.accountant}/invite`).set(as('sysadmin'));
    expect(re.status, JSON.stringify(re.body)).toBe(422);
    expect(re.body.error.code).toBe('ROLE_RETIRED');
    // Unrelated fields, and re-sending the role they already hold, still work.
    const pa = await http()
      .patch(`/v1/employees/${created.accountant}`)
      .set(as('sysadmin'))
      .send({ version: 1, designation: 'Senior Accountant', role: 'accountant' });
    expect(pa.status, JSON.stringify(pa.body)).toBe(200);
    // Assigning a retired role to someone who does not hold it: 422.
    const other = await http()
      .patch(`/v1/employees/${created.accountant}`)
      .set(as('sysadmin'))
      .send({ version: pa.body.version, role: 'distribution_head' });
    expect(other.status, JSON.stringify(other.body)).toBe(422);
    expect(other.body.error.code).toBe('ROLE_RETIRED');
    expect(
      (await http().post(`/v1/employees/${U.sysadmin}/invite`).set(as('sysadmin'))).status,
    ).toBe(403);
  });

  it('a retired-role holder cannot accept their pending invite (422 ROLE_RETIRED); invite stays unused', async () => {
    const h = await insertRetiredHolder(`${RUN}.acc-accept@demo.ariforce.in`, 'accountant');
    const res = await http()
      .post('/v1/invites/accept')
      .send({ token: h.token, password: 'a-long-enough-password' });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe('ROLE_RETIRED');
    const list = await http().get('/v1/users').query({ q: RUN, limit: 100 }).set(as('sysadmin'));
    expect(list.body.items.find((u: { id: string }) => u.id === h.id)).toMatchObject({
      hasLogin: false,
      inviteStatus: 'pending',
    });
  });

  it('non-admin limits are unchanged', async () => {
    for (const role of ['system_admin', 'director'])
      expect((await post('abm', emp(role, { territoryIds: [T.hq] }))).status).toBe(403);
    for (const role of ['accountant', 'distribution_head'])
      expect((await post('abm', emp(role, { territoryIds: [T.hq] }))).status).toBe(422);
    expect(
      (await post('abm', emp('business_manager', { territoryIds: [T.otherArea] }))).status,
    ).toBe(403);
    expect((await post('abm', emp('business_manager'))).status).toBe(422);
    expect((await post('director', emp('accountant'))).status).toBe(422);
    // A director has the system admin's powers over people (users:write): may add a director.
    expect((await post('director', emp('director', { territoryIds: [T.national] }))).status).toBe(
      201,
    );
    expect((await post('dh', emp('business_manager', { territoryIds: [T.hq] }))).status).toBe(403);
    expect(
      (await http().post(`/v1/employees/${created.accountant}/invite`).set(as('dh'))).status,
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
