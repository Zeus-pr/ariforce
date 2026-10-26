import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID, T, seedIds } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const HQ_DOC = seedIds.id('6', 1);
const OTHER_AREA_DOC = seedIds.id('6', 2);
const B = '01930000-0000-7000-8000-00000000000b';
const B_TERR = '01930000-0000-7000-8000-0000000b0001';
const B_DOC = '01930000-0000-7000-8000-0000000b0002';

// Integration: real Postgres (CI service), app connects as the non-bypass role. Skipped without a DB.
describe.skipIf(!OWNER || !APP)('auth + RBAC (better-auth, hierarchy scope, RLS)', () => {
  let app: INestApplication;
  let owner: Pool;
  const http = () => request(app.getHttpServer());

  async function signIn(email: string, password = PASSWORD) {
    return http().post('/v1/auth/sign-in/email').send({ email, password });
  }
  async function token(email: string) {
    const res = await signIn(email);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const t = res.headers['set-auth-token'];
    expect(t).toBeTruthy();
    return `Bearer ${t}`;
  }

  beforeAll(async () => {
    owner = new Pool({ connectionString: OWNER });
    await owner.query(
      `insert into companies (id, name, slug) values ($1, 'Other Pharma', 'other') on conflict do nothing`,
      [B],
    );
    await owner.query(
      `insert into territories (id, company_id, level, code, name, path)
       values ($1, $2, 'national', 'IN', 'India', $3) on conflict do nothing`,
      [B_TERR, B, B_TERR],
    );
    await owner.query(
      `insert into doctors (id, company_id, territory_id, name) values ($1, $2, $3, 'Dr. Other')
       on conflict do nothing`,
      [B_DOC, B, B_TERR],
    );
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  it('401 without a session, in the standard error shape', async () => {
    const res = await http().get('/v1/doctors');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a wrong password', async () => {
    const res = await signIn('bm@demo.ariforce.in', 'wrong-password-123');
    expect(res.status).toBe(401);
  });

  it('GET /v1/me returns roles, permissions and territories', async () => {
    const auth = await token('bm@demo.ariforce.in');
    const res = await http().get('/v1/me').set('authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ companyId: DEMO_COMPANY_ID, roles: ['business_manager'] });
    expect(res.body.permissions).toContain('masters:read');
    expect(res.body.territoryIds).toEqual([T.hq]);
  });

  it('business manager sees only doctors in their HQ subtree', async () => {
    const auth = await token('bm@demo.ariforce.in');
    const res = await http().get('/v1/doctors').set('authorization', auth);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((d: { id: string }) => d.id);
    expect(ids).toContain(HQ_DOC);
    expect(ids).not.toContain(OTHER_AREA_DOC);
    expect(ids).not.toContain(B_DOC);
    expect(
      (await http().get(`/v1/doctors/${OTHER_AREA_DOC}`).set('authorization', auth)).status,
    ).toBe(404);
  });

  it('area business manager: own area yes, sibling area no (out-of-hierarchy = 404)', async () => {
    const auth = await token('abm@demo.ariforce.in');
    expect((await http().get(`/v1/doctors/${HQ_DOC}`).set('authorization', auth)).status).toBe(200);
    expect(
      (await http().get(`/v1/doctors/${OTHER_AREA_DOC}`).set('authorization', auth)).status,
    ).toBe(404);
  });

  it('system admin sees all masters but never another tenant (RLS)', async () => {
    const auth = await token('sysadmin@demo.ariforce.in');
    expect(
      (await http().get(`/v1/doctors/${OTHER_AREA_DOC}`).set('authorization', auth)).status,
    ).toBe(200);
    expect((await http().get(`/v1/doctors/${B_DOC}`).set('authorization', auth)).status).toBe(404);
    const list = await http().get('/v1/doctors?limit=200').set('authorization', auth);
    expect(
      list.body.items.every((d: { companyId: string }) => d.companyId === DEMO_COMPANY_ID),
    ).toBe(true);
  });

  it('reporting line: RBM sees both teams, director sees all, system admin has no field permissions', async () => {
    const rbm = await token('rbm@demo.ariforce.in');
    expect(
      (await http().get(`/v1/doctors/${OTHER_AREA_DOC}`).set('authorization', rbm)).status,
    ).toBe(200);
    expect((await http().get(`/v1/doctors/${HQ_DOC}`).set('authorization', rbm)).status).toBe(200);
    const dir = await token('director@demo.ariforce.in');
    expect(
      (await http().get(`/v1/doctors/${OTHER_AREA_DOC}`).set('authorization', dir)).status,
    ).toBe(200);
    const me = await http().get('/v1/me').set('authorization', dir);
    expect(me.body.roles).toEqual(['director']);
    const sysAuth = await token('sysadmin@demo.ariforce.in');
    const sys = await http().get('/v1/me').set('authorization', sysAuth);
    expect(sys.body.roles).toEqual(['system_admin']);
    expect(sys.body.permissions).not.toContain('field:read');
    expect(sys.body.managerId).toBeNull();
  });

  it('distribution_head / accountant: outside the hierarchy, domain permission only, no field or doctor data', async () => {
    for (const [email, role, perm] of [
      ['dh@demo.ariforce.in', 'distribution_head', 'sales:read'],
      ['accountant@demo.ariforce.in', 'accountant', 'finance:read'],
    ] as const) {
      const auth = await token(email);
      const me = await http().get('/v1/me').set('authorization', auth);
      expect(me.status, JSON.stringify(me.body)).toBe(200);
      expect(me.body.roles).toEqual([role]);
      expect(me.body.permissions).toContain(perm);
      expect(me.body.permissions).not.toContain('field:read');
      expect(me.body.permissions).not.toContain('approvals:decide');
      expect(me.body.managerId).toBeNull();
      expect((await http().get('/v1/doctors').set('authorization', auth)).status).toBe(403);
      expect((await http().get('/v1/dcrs').set('authorization', auth)).status).toBe(403);
      expect((await http().get('/v1/kpis').set('authorization', auth)).status).toBe(403);
      // Approvals list is open to everyone (own requests), but nothing is ever routed to them.
      const queue = await http().get('/v1/approvals?mine=to_decide').set('authorization', auth);
      expect(queue.body.items).toEqual([]);
    }
    const dirTok = await token('director@demo.ariforce.in');
    const roles = await http().get('/v1/roles').set('authorization', dirTok);
    const keys = roles.body.items.map((r: { key: string; inHierarchy: boolean }) => [
      r.key,
      r.inHierarchy,
    ]);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['distribution_head', false],
        ['accountant', false],
      ]),
    );
  });

  it('business manager cannot create a doctor outside their hierarchy (403); inside = 201 + audit row', async () => {
    const auth = await token('bm@demo.ariforce.in');
    const body = {
      name: 'Dr. New Field',
      qualification: null,
      specialtyId: null,
      categoryId: null,
      registrationNo: null,
      addressLine: null,
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700004',
      location: { lat: 22.6, lng: 88.37 },
      phone: null,
    };
    const denied = await http()
      .post('/v1/doctors')
      .set('authorization', auth)
      .send({ ...body, territoryId: T.otherArea });
    expect(denied.status).toBe(403);
    const ok = await http()
      .post('/v1/doctors')
      .set('authorization', auth)
      .send({ ...body, territoryId: T.hq });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const { rows } = await owner.query(
      `select action from audit_log where entity_id = $1 and action = 'doctor.create'`,
      [ok.body.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('writes sign-in and sign-out to the audit log', async () => {
    const auth = await token('rbm@demo.ariforce.in');
    const out = await http().post('/v1/auth/sign-out').set('authorization', auth).send({});
    expect(out.status).toBe(200);
    const { rows } = await owner.query(
      `select action from audit_log a join users u on u.id = a.actor_user_id
       where u.email = 'rbm@demo.ariforce.in' and action like 'auth.%'`,
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('auth.sign_in');
    expect(actions).toContain('auth.sign_out');
    expect((await http().get('/v1/me').set('authorization', auth)).status).toBe(401);
  });

  it('validation failures are 422 with the error shape', async () => {
    const auth = await token('sysadmin@demo.ariforce.in');
    const res = await http().post('/v1/doctors').set('authorization', auth).send({ name: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION');
  });
});
