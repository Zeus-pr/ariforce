import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
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
    for (const who of ['director', 'bm', 'abm', 'dh']) {
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
    expect(
      (await http().post('/v1/invites/accept').send({ token: first, password: pw })).status,
    ).toBe(404);
    const acc = await http().post('/v1/invites/accept').send({ token, password: pw });
    expect(acc.status).toBe(200);
    expect(acc.body.email).toBe(b.email);
    expect((await http().post('/v1/invites/accept').send({ token, password: pw })).status).toBe(
      404,
    );
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

  it('invalid invite token is a 404', async () => {
    const r = await http()
      .post('/v1/invites/accept')
      .send({ token: 'x'.repeat(43), password: 'longenough' });
    expect(r.status).toBe(404);
  });
});
