import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const RUN = Date.now().toString(36);

describe.skipIf(!OWNER || !APP)('Team + employees (real API)', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  const emp = (over: Record<string, unknown> = {}) => ({
    name: `New BM ${RUN}`,
    email: `bm.${RUN}.${Math.random().toString(36).slice(2, 7)}@demo.ariforce.in`,
    role: 'business_manager',
    designation: 'Medical Representative',
    territoryIds: [T.hq],
    ...over,
  });

  beforeAll(async () => {
    process.env.INVITE_RETURN_LINK = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['director', 'bm', 'abm', 'dh', 'sysadmin']) {
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

  it('GET /v1/team returns the caller subtree; functional roles are not in it', async () => {
    const abm = await http().get('/v1/team').set(as('abm'));
    expect(abm.status).toBe(200);
    expect(abm.body.rootId).toBe(U.area);
    expect(abm.body.nodes[0]).toMatchObject({ id: U.area, depth: 0 });
    expect(abm.body.nodes.map((n: { id: string }) => n.id)).toContain(U.rep);
    expect(Array.isArray(abm.body.unassigned)).toBe(true);
    const dir = await http().get('/v1/team').set(as('director'));
    const ids = [...dir.body.nodes, ...dir.body.unassigned].map((n: { id: string }) => n.id);
    expect(ids).not.toContain(U.dh);
    expect(ids).not.toContain(U.accountant);
    const bm = await http().get('/v1/team').set(as('bm'));
    expect(bm.body.unassigned).toEqual([]);
  });

  it('escalation attempts fail', async () => {
    const post = (who: string, b: object) => http().post('/v1/employees').set(as(who)).send(b);
    expect((await post('bm', emp())).status).toBe(403);
    expect((await post('dh', emp())).status).toBe(403);
    expect((await post('abm', emp({ role: 'area_business_manager' }))).status).toBe(403);
    expect((await post('abm', emp({ role: 'director' }))).status).toBe(403);
    expect((await post('abm', emp({ role: 'system_admin' }))).status).toBe(403);
    expect((await post('abm', emp({ role: 'accountant' }))).status).toBe(403);
    expect((await post('abm', emp({ territoryIds: [T.otherArea] }))).status).toBe(403);
    expect((await post('abm', emp({ managerId: U.director }))).status).toBe(403);
    const self = await http().get('/v1/team').set(as('abm'));
    const me = self.body.nodes[0];
    const patch = (id: string, b: object) =>
      http().patch(`/v1/employees/${id}`).set(as('abm')).send(b);
    expect((await patch(U.area, { version: me.version, role: 'director' })).status).toBe(403);
    expect((await patch(U.regional, { version: 1, status: 'suspended' })).status).toBe(403);
    expect((await patch(U.director, { version: 1, name: 'x' })).status).toBe(403);
    expect(
      (
        await http()
          .post(`/v1/team/${U.rep}/manager`)
          .set(as('abm'))
          .send({ managerId: U.director })
      ).status,
    ).toBe(403);
  });

  it('ABM adds a BM, invite is single-use and activates the account; deactivate blocks sign-in', async () => {
    const b = emp();
    const res = await http().post('/v1/employees').set(as('abm')).send(b);
    expect(res.status).toBe(201);
    expect(res.body.employee).toMatchObject({
      status: 'invited',
      managerId: U.area,
      designation: 'Medical Representative',
      role: 'business_manager',
    });
    expect((await http().post('/v1/employees').set(as('abm')).send(b)).status).toBe(409);
    // Re-invite revokes the first token.
    const first = new URL(res.body.invite.inviteUrl).searchParams.get('token')!;
    const re = await http().post(`/v1/employees/${res.body.employee.id}/invite`).set(as('abm'));
    expect(re.status).toBe(201);
    const token = new URL(re.body.invite?.inviteUrl ?? re.body.inviteUrl).searchParams.get(
      'token',
    )!;
    const pw = `pw-${RUN}-long`;
    const revoked = await http().post('/v1/invites/accept').send({ token: first, password: pw });
    expect(revoked.status).toBe(404);
    expect(revoked.body.error.code).toBe('INVITE_INVALID');
    const acc = await http().post('/v1/invites/accept').send({ token, password: pw });
    expect(acc.status).toBe(200);
    expect(acc.body.email).toBe(b.email);
    const used = await http().post('/v1/invites/accept').send({ token, password: pw });
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('INVITE_USED');
    const signIn = () =>
      http().post('/v1/auth/sign-in/email').send({ email: b.email, password: pw });
    const s = await signIn();
    expect(s.status).toBe(200);
    const meRes = await http()
      .get('/v1/me')
      .set({ authorization: `Bearer ${s.headers['set-auth-token']}` });
    expect(meRes.status).toBe(200);

    const node = (await http().get('/v1/team').set(as('abm'))).body.nodes.find(
      (n: { id: string }) => n.id === res.body.employee.id,
    );
    expect(node.status).toBe('active');
    const stale = await http()
      .patch(`/v1/employees/${node.id}`)
      .set(as('abm'))
      .send({ version: node.version - 1, status: 'suspended' });
    expect(stale.status).toBe(409);
    const off = await http()
      .patch(`/v1/employees/${node.id}`)
      .set(as('abm'))
      .send({ version: node.version, status: 'suspended' });
    expect(off.status).toBe(200);
    expect(off.body.status).toBe('suspended');
    const blocked = await http()
      .get('/v1/me')
      .set({ authorization: `Bearer ${s.headers['set-auth-token']}` });
    expect([401, 403]).toContain(blocked.status);
  });

  it('manager reassignment within the subtree; cycles rejected', async () => {
    const res = await http()
      .post('/v1/employees')
      .set(as('director'))
      .send(emp({ managerId: U.area }));
    expect(res.status).toBe(201);
    const id = res.body.employee.id;
    const ok = await http()
      .post(`/v1/team/${id}/manager`)
      .set(as('director'))
      .send({ managerId: U.regional });
    expect(ok.status).toBe(200);
    expect(ok.body.managerId).toBe(U.regional);
    const cyc = await http()
      .post(`/v1/team/${U.regional}/manager`)
      .set(as('director'))
      .send({ managerId: U.area });
    expect(cyc.status).toBe(409);
  });

  it('system admin creates a director (no manager), invite link sets the password, director signs in', async () => {
    const b = emp({
      name: `prajdir ${RUN}`,
      email: `dir.${RUN}@demo.ariforce.in`,
      role: 'director',
      designation: 'Director',
      territoryIds: [T.national],
    });
    expect((await http().post('/v1/employees').set(as('director')).send(b)).status).toBe(403);
    expect((await http().post('/v1/employees').set(as('abm')).send(b)).status).toBe(403);
    expect(
      (
        await http()
          .post('/v1/employees')
          .set(as('sysadmin'))
          .send({ ...b, managerId: U.director })
      ).status,
    ).toBe(422);
    const res = await http().post('/v1/employees').set(as('sysadmin')).send(b);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.employee).toMatchObject({
      role: 'director',
      managerId: null,
      status: 'invited',
    });
    const re = await http()
      .post(`/v1/employees/${res.body.employee.id}/invite`)
      .set(as('sysadmin'));
    expect(re.status).toBe(201);
    const token = new URL(re.body.inviteUrl).searchParams.get('token')!;
    expect(re.body.inviteUrl).toMatch(/\/invite\?token=/);
    const pw = `dir-${RUN}-long-pass`;
    expect((await http().post('/v1/invites/accept').send({ token, password: pw })).status).toBe(
      200,
    );
    const s = await http().post('/v1/auth/sign-in/email').send({ email: b.email, password: pw });
    expect(s.status).toBe(200);
    const me = await http()
      .get('/v1/me')
      .set({ authorization: `Bearer ${s.headers['set-auth-token']}` });
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).toContain('director');
    expect(
      (await http().post(`/v1/employees/${res.body.employee.id}/invite`).set(as('sysadmin')))
        .status,
    ).toBe(409);
    // ABM still cannot create anyone at or above its own rank.
    expect(
      (
        await http()
          .post('/v1/employees')
          .set(as('abm'))
          .send(emp({ role: 'regional_business_manager' }))
      ).status,
    ).toBe(403);
  });

  it('invalid invite token is a 404 INVITE_INVALID', async () => {
    const r = await http()
      .post('/v1/invites/accept')
      .send({ token: 'x'.repeat(43), password: 'long-enough-pw' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('INVITE_INVALID');
  });

  it('invite accept: password min 12 (422) and expired invite is 410 INVITE_EXPIRED', async () => {
    const res = await http().post('/v1/employees').set(as('abm')).send(emp());
    expect(res.status).toBe(201);
    const token = new URL(res.body.invite.inviteUrl).searchParams.get('token')!;
    const short = await http().post('/v1/invites/accept').send({ token, password: 'elevenchars' });
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe('VALIDATION');
    const owner = new Pool({ connectionString: OWNER });
    try {
      await owner.query(
        `update user_invites set expires_at = now() - interval '1 minute' where id = $1`,
        [res.body.invite.id],
      );
    } finally {
      await owner.end();
    }
    const exp = await http().post('/v1/invites/accept').send({ token, password: 'twelve-chars' });
    expect(exp.status).toBe(410);
    expect(exp.body.error.code).toBe('INVITE_EXPIRED');
  });

  it('POST /v1/employees/invite-bulk: partial success, per-row results, audited', async () => {
    const existing = emp();
    expect((await http().post('/v1/employees').set(as('abm')).send(existing)).status).toBe(201);
    const a = emp();
    const b = emp();
    const rows = [
      a,
      b,
      { ...emp(), email: a.email.toUpperCase() }, // repeated in batch
      { ...emp(), email: existing.email }, // already exists
      emp({ role: 'regional_business_manager' }), // above the caller's allowed roles
      { name: 'No email', role: 'business_manager', territoryIds: [T.hq] }, // invalid row
    ];
    const r = await http()
      .post('/v1/employees/invite-bulk')
      .set(as('abm'))
      .send({ employees: rows });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.summary).toEqual({ invited: 2, skipped: 2, failed: 2 });
    const by = (i: number) => r.body.results[i];
    expect(by(0)).toMatchObject({ index: 0, email: a.email, status: 'invited', code: null });
    expect(by(0).employeeId).toBeTruthy();
    expect(by(0).inviteUrl).toMatch(/\/invite\?token=/); // INVITE_RETURN_LINK=true in tests
    expect(by(1).status).toBe('invited');
    expect(by(2)).toMatchObject({ status: 'skipped', code: 'DUPLICATE_IN_BATCH' });
    expect(by(3)).toMatchObject({ status: 'skipped', code: 'CONFLICT' });
    expect(by(4)).toMatchObject({ status: 'failed', code: 'FORBIDDEN', employeeId: null });
    expect(by(5)).toMatchObject({ status: 'failed', code: 'VALIDATION', email: null });
    // Invited rows can accept their own invite.
    const token = new URL(by(0).inviteUrl).searchParams.get('token')!;
    expect(
      (
        await http()
          .post('/v1/invites/accept')
          .send({ token, password: `bulk-${RUN}-pass` })
      ).status,
    ).toBe(200);
    const owner = new Pool({ connectionString: OWNER });
    try {
      const au = await owner.query(
        `select action from audit_log where entity_id = $1 and action in ('employee.created','employee.invited')`,
        [by(1).employeeId],
      );
      expect(au.rows.map((x) => x.action).sort()).toEqual(['employee.created', 'employee.invited']);
      const batch = await owner.query(
        `select after from audit_log where action = 'employee.invite_bulk' and entity_id = $1 order by at desc limit 1`,
        [U.area],
      );
      expect(batch.rows[0].after.summary).toEqual({ invited: 2, skipped: 2, failed: 2 });
      expect(JSON.stringify(batch.rows[0].after)).not.toContain('@');
    } finally {
      await owner.end();
    }
  });

  it('invite-bulk: same rank gate, batch cap 200, no link in production', async () => {
    expect(
      (
        await http()
          .post('/v1/employees/invite-bulk')
          .set(as('bm'))
          .send({ employees: [emp()] })
      ).status,
    ).toBe(403);
    const big = Array.from({ length: 201 }, () => emp());
    expect(
      (await http().post('/v1/employees/invite-bulk').set(as('abm')).send({ employees: big }))
        .status,
    ).toBe(422);
    expect(
      (await http().post('/v1/employees/invite-bulk').set(as('abm')).send({ employees: [] }))
        .status,
    ).toBe(422);
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const r = await http()
        .post('/v1/employees/invite-bulk')
        .set(as('abm'))
        .send({ employees: [emp()] });
      expect(r.body.results[0]).toMatchObject({ status: 'invited', inviteUrl: null });
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
