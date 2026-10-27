import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { SignupService } from '../src/team/signup.service';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const RUN = Date.now().toString(36);
const PW = `signup-${RUN}-pass`;

describe.skipIf(!OWNER || !APP)('Sign-up requests (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let n = 0;
  const email = (tag: string) => `su.${tag}.${RUN}.${++n}@example.test`;
  const submit = (over: Record<string, unknown>) =>
    http()
      .post('/v1/auth/sign-up-request')
      .send({
        name: `Signup ${RUN}`,
        email: email('x'),
        password: PW,
        requestedRole: 'business_manager',
        territoryId: T.hq,
        ...over,
      });
  const signIn = (e: string, pw = PW) =>
    http().post('/v1/auth/sign-in/email').send({ email: e, password: pw });
  const reqId = async (e: string) =>
    (
      await owner.query(
        `select r.id from signup_requests r join users u on u.id = r.user_id where lower(u.email) = lower($1) order by r.created_at desc limit 1`,
        [e],
      )
    ).rows[0]?.id as string;

  beforeAll(async () => {
    process.env.SIGNUP_COMPANY_SLUG = 'demo';
    process.env.SIGNUP_RATE_PER_IP = '1000';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    for (const who of ['sysadmin', 'director', 'gm', 'abm', 'bm', 'dh']) {
      const res = await signIn(`${who}@demo.ariforce.in`, PASSWORD);
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
  });
  beforeEach(() => app.get(SignupService).limiter.reset());
  afterAll(async () => {
    delete process.env.SIGNUP_COMPANY_SLUG;
    delete process.env.SIGNUP_RATE_PER_IP;
    await owner?.end();
    await app?.close();
  });

  it('pending user cannot sign in; ABM approves within scope; then sign-in and data access work', async () => {
    const e = email('bm');
    const res = await submit({ email: e });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.status).toBe('pending');
    const s = await signIn(e);
    expect(s.status).toBe(403);
    expect(s.body.code).toBe('ACCOUNT_PENDING_APPROVAL');
    expect(s.headers['set-auth-token']).toBeUndefined();
    // No role was granted by the request itself.
    const { rows } = await owner.query(
      `select u.status, (select count(*)::int from user_roles ur where ur.user_id = u.id) as n from users u where lower(email) = $1`,
      [e],
    );
    expect(rows[0]).toEqual({ status: 'pending', n: 0 });
    const list = await http().get('/v1/signup-requests').set(as('abm'));
    expect(list.status).toBe(200);
    const id = await reqId(e);
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(id);
    // Role above own level is refused even for a visible request.
    expect(
      (
        await http()
          .post(`/v1/signup-requests/${id}/approve`)
          .set(as('abm'))
          .send({ role: 'regional_business_manager' })
      ).status,
    ).toBe(403);
    const ok = await http()
      .post(`/v1/signup-requests/${id}/approve`)
      .set(as('abm'))
      .send({ role: 'business_manager' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', approvedRole: 'business_manager' });
    const again = await http()
      .post(`/v1/signup-requests/${id}/approve`)
      .set(as('abm'))
      .send({ role: 'business_manager' });
    expect(again.status).toBe(409);
    const s2 = await signIn(e);
    expect(s2.status).toBe(200);
    const auth = { authorization: `Bearer ${s2.headers['set-auth-token']}` };
    const me = await http().get('/v1/me').set(auth);
    expect(me.status).toBe(200);
    const mgr = await owner.query(`select manager_id from users where lower(email) = $1`, [e]);
    expect(mgr.rows[0].manager_id).toBe(U.area);
    expect((await http().get('/v1/doctors').set(auth)).status).toBe(200);
    // An existing session (cookie or bearer) is dead as soon as the account is pending again.
    await owner.query(`update users set status = 'pending' where lower(email) = $1`, [e]);
    for (const path of ['/v1/me', '/v1/doctors', '/v1/team', '/v1/signup-requests']) {
      const r = await http().get(path).set(auth);
      expect(r.status, path).toBe(403);
      expect(r.body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
    }
    await owner.query(`update users set status = 'active' where lower(email) = $1`, [e]);
    const audit = await owner.query(
      `select action from audit_log where entity_id = $1 order by at`,
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['signup.requested', 'signup.approved']);
  });

  it('ABM does not see or decide requests outside their subtree or at/above their level', async () => {
    const out = email('out');
    expect(
      (await submit({ email: out, territoryId: T.otherArea, managerId: U.regional })).status,
    ).toBe(202);
    const high = email('high');
    expect((await submit({ email: high, requestedRole: 'regional_business_manager' })).status).toBe(
      202,
    );
    const dh = email('dh');
    expect(
      (await submit({ email: dh, requestedRole: 'distribution_head', territoryId: null })).status,
    ).toBe(202);
    const ids = (await http().get('/v1/signup-requests').set(as('abm'))).body.items.map(
      (x: { id: string }) => x.id,
    );
    for (const e of [out, high, dh]) {
      const id = await reqId(e);
      expect(ids).not.toContain(id);
      expect(
        (
          await http()
            .post(`/v1/signup-requests/${id}/approve`)
            .set(as('abm'))
            .send({ role: 'business_manager' })
        ).status,
      ).toBe(404);
    }
    // BM and functional roles cannot review sign-ups at all.
    expect((await http().get('/v1/signup-requests').set(as('bm'))).status).toBe(403);
    expect((await http().get('/v1/signup-requests').set(as('dh'))).status).toBe(403);
    // System admin sees all of them and can grant a functional role (no manager, no territory).
    const all = (await http().get('/v1/signup-requests').set(as('sysadmin'))).body.items.map(
      (x: { id: string }) => x.id,
    );
    for (const e of [out, high, dh]) expect(all).toContain(await reqId(e));
    const ok = await http()
      .post(`/v1/signup-requests/${await reqId(dh)}/approve`)
      .set(as('sysadmin'))
      .send({ role: 'distribution_head' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await signIn(dh)).status).toBe(200);
  });

  it('system admin approves a director: no manager; manager given = 422', async () => {
    const e = email('dir');
    expect(
      (await submit({ email: e, requestedRole: 'director', territoryId: T.national })).status,
    ).toBe(202);
    const id = await reqId(e);
    expect(
      (
        await http()
          .post(`/v1/signup-requests/${id}/approve`)
          .set(as('director'))
          .send({ role: 'director' })
      ).status,
    ).toBe(404);
    expect(
      (
        await http()
          .post(`/v1/signup-requests/${id}/approve`)
          .set(as('sysadmin'))
          .send({ role: 'director', managerId: U.director })
      ).status,
    ).toBe(422);
    const ok = await http()
      .post(`/v1/signup-requests/${id}/approve`)
      .set(as('sysadmin'))
      .send({ role: 'director' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const u = await owner.query(
      `select u.manager_id, r.key from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id where lower(u.email) = $1`,
      [e],
    );
    expect(u.rows).toEqual([{ manager_id: null, key: 'director' }]);
    expect((await signIn(e)).status).toBe(200);
  });

  it('reject: sign-in returns ACCOUNT_REJECTED; deciding again is 409', async () => {
    const e = email('rej');
    expect((await submit({ email: e })).status).toBe(202);
    const id = await reqId(e);
    const r = await http()
      .post(`/v1/signup-requests/${id}/reject`)
      .set(as('sysadmin'))
      .send({ reason: 'Unknown person' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'rejected', reason: 'Unknown person' });
    const s = await signIn(e);
    expect(s.status).toBe(403);
    expect(s.body.code).toBe('ACCOUNT_REJECTED');
    expect(
      (
        await http()
          .post(`/v1/signup-requests/${id}/reject`)
          .set(as('sysadmin'))
          .send({ reason: 'again' })
      ).status,
    ).toBe(409);
    const a = await owner.query(
      `select 1 from audit_log where entity_id = $1 and action = 'signup.rejected'`,
      [id],
    );
    expect(a.rowCount).toBe(1);
    // A rejected email cannot simply sign up again.
    expect((await submit({ email: e })).status).toBe(409);
  });

  it('links an existing employee row without a login, still pending until approved', async () => {
    const e = email('emp');
    const { rows } = await owner.query(
      `insert into users (id, company_id, email, name, status)
       select gen_random_uuid(), company_id, $1, 'Loaded Employee', 'active' from users where id = $2
       returning id`,
      [e, U.director],
    );
    const res = await submit({ email: e.toUpperCase(), name: 'Self Name' });
    expect(res.status).toBe(202);
    const u = await owner.query(
      `select id, status, auth_user_id is not null as linked from users where lower(email) = $1`,
      [e],
    );
    expect(u.rows).toEqual([{ id: rows[0].id, status: 'pending', linked: true }]);
    expect((await signIn(e)).body.code).toBe('ACCOUNT_PENDING_APPROVAL');
  });

  it('no enumeration: existing login and repeated email both get the same generic 409', async () => {
    const a = await submit({ email: 'bm@demo.ariforce.in' });
    const e = email('dup');
    expect((await submit({ email: e })).status).toBe(202);
    const b = await submit({ email: e });
    expect(a.status).toBe(409);
    expect(b.status).toBe(409);
    expect(a.body).toEqual(b.body);
    expect(a.body.error.code).toBe('SIGNUP_UNAVAILABLE');
    expect(JSON.stringify(a.body)).not.toMatch(/exists|already registered/i);
  });

  it('validation: system_admin cannot be requested; short password; unknown territory', async () => {
    expect((await submit({ requestedRole: 'system_admin' })).status).toBe(422);
    expect((await submit({ password: 'short-pass' })).status).toBe(422);
    expect((await submit({ territoryId: '00000000-0000-4000-8000-00000000ffff' })).status).toBe(
      422,
    );
  });

  it('rate limit per email and per IP', async () => {
    const e = email('rl');
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await submit({ email: e })).status);
    expect(codes).toEqual([202, 409, 409, 429]);
    process.env.SIGNUP_RATE_PER_IP = '2';
    try {
      app.get(SignupService).limiter.reset();
      const r = [];
      for (let i = 0; i < 3; i++) r.push((await submit({})).status);
      expect(r).toEqual([202, 202, 429]);
      expect((await submit({})).body.error.code).toBe('RATE_LIMITED');
    } finally {
      process.env.SIGNUP_RATE_PER_IP = '1000';
    }
  });

  const listed = async (who: string) =>
    ((await http().get('/v1/signup-requests').set(as(who))).body.items ?? []).map(
      (x: { id: string }) => x.id,
    ) as string[];
  /** Visibility and approval authority must agree: hidden => 404 on decide. */
  const decideStatus = async (who: string, id: string) =>
    (await http().post(`/v1/signup-requests/${id}/reject`).set(as(who)).send({ reason: 'probe' }))
      .status;

  it('unassigned requests (no manager): every ABM+ above the role sees them; BM cannot review', async () => {
    const e = email('unassigned');
    expect((await submit({ email: e, territoryId: null, managerId: null })).status).toBe(202);
    const id = await reqId(e);
    for (const who of ['sysadmin', 'director', 'gm', 'abm'])
      expect(await listed(who)).toContain(id);
    expect((await http().get('/v1/signup-requests').set(as('bm'))).status).toBe(403);
    // Unassigned ABM request: equal rank for ABM (hidden, 404), visible to GM.
    const ea = email('unassigned-abm');
    expect(
      (
        await submit({
          email: ea,
          requestedRole: 'area_business_manager',
          territoryId: null,
          managerId: null,
        })
      ).status,
    ).toBe(202);
    const ida = await reqId(ea);
    expect(await listed('abm')).not.toContain(ida);
    expect(await listed('gm')).toContain(ida);
    expect(await decideStatus('abm', ida)).toBe(404);
    // Director approves the unassigned BM: manager defaults to the director.
    const ok = await http()
      .post(`/v1/signup-requests/${id}/approve`)
      .set(as('director'))
      .send({ role: 'business_manager', territoryIds: [T.hq] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const { rows } = await owner.query(
      `select u.manager_id from users u join signup_requests r on r.user_id = u.id where r.id = $1`,
      [id],
    );
    expect(rows[0].manager_id).toBe(U.director);
    expect(await decideStatus('gm', ida)).toBe(200);
  });

  it('assigned requests: visible and decidable only inside the approver subtree', async () => {
    const mine = email('mine');
    expect((await submit({ email: mine, managerId: U.area, territoryId: null })).status).toBe(202);
    const above = email('above');
    expect(
      (await submit({ email: above, managerId: U.regional, territoryId: T.otherArea })).status,
    ).toBe(202);
    const idMine = await reqId(mine);
    const idAbove = await reqId(above);
    expect(await listed('abm')).toContain(idMine);
    expect(await listed('abm')).not.toContain(idAbove);
    for (const who of ['sysadmin', 'director', 'gm']) {
      expect(await listed(who)).toContain(idMine);
      expect(await listed(who)).toContain(idAbove);
    }
    expect(await decideStatus('abm', idAbove)).toBe(404);
    expect(await decideStatus('gm', idAbove)).toBe(200);
    expect(await decideStatus('abm', idMine)).toBe(200);
  });

  it('GET /v1/auth/sign-up-options: public pick-lists without PII', async () => {
    const r = await http().get('/v1/auth/sign-up-options');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.territories.length).toBeGreaterThan(0);
    for (const t of r.body.territories)
      expect(Object.keys(t).sort()).toEqual(['code', 'id', 'name']);
    for (const m of r.body.managers) expect(Object.keys(m).sort()).toEqual(['id', 'name', 'role']);
    const ids = r.body.managers.map((m: { id: string }) => m.id);
    for (const u of [U.director, U.gm, U.area, U.regional]) expect(ids).toContain(u);
    for (const u of [U.sysadmin, U.rep, U.otherRep, U.dh, U.accountant])
      expect(ids).not.toContain(u);
    expect(JSON.stringify(r.body)).not.toContain('@');
    process.env.SIGNUP_COMPANY_SLUG = 'no-such-company';
    try {
      const d = await http().get('/v1/auth/sign-up-options');
      expect(d.status).toBe(503);
      expect(d.body.error.code).toBe('SIGNUP_DISABLED');
    } finally {
      process.env.SIGNUP_COMPANY_SLUG = 'demo';
    }
    process.env.SIGNUP_RATE_PER_IP = '1';
    try {
      const codes = [];
      for (let i = 0; i < 8; i++) codes.push((await http().get('/v1/auth/sign-up-options')).status);
      expect(codes).toContain(429);
    } finally {
      process.env.SIGNUP_RATE_PER_IP = '1000';
    }
  });

  it('nobody can decide their own request', async () => {
    const { rows } = await owner.query(
      `insert into signup_requests (id, company_id, user_id, requested_role)
       select gen_random_uuid(), company_id, id, 'director' from users where id = $1 returning id`,
      [U.sysadmin],
    );
    const r = await http()
      .post(`/v1/signup-requests/${rows[0].id}/approve`)
      .set(as('sysadmin'))
      .send({ role: 'director' });
    expect(r.status).toBe(403);
    await owner.query(`update signup_requests set status = 'rejected' where id = $1`, [rows[0].id]);
  });
});
