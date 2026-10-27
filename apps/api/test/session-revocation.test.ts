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

// #79: deactivation and role changes revoke every session; deactivated users cannot sign in.
describe.skipIf(!OWNER || !APP)('session revocation (real API)', () => {
  let app: INestApplication;
  let director: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.INVITE_RETURN_LINK = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    const res = await http()
      .post('/v1/auth/sign-in/email')
      .send({ email: 'director@demo.ariforce.in', password: PASSWORD });
    director = `Bearer ${res.headers['set-auth-token']}`;
  });
  afterAll(async () => {
    delete process.env.INVITE_RETURN_LINK;
    await app?.close();
  });

  it('role change and deactivation refuse old cookie + bearer (401); suspended cannot sign in', async () => {
    const email = `rev.${RUN}@demo.ariforce.in`;
    const pw = `pw-${RUN}-long`;
    const created = await http()
      .post('/v1/employees')
      .set({ authorization: director })
      .send({
        name: `Rev ${RUN}`,
        email,
        role: 'business_manager',
        designation: 'Medical Representative',
        territoryIds: [T.hq],
        managerId: U.area,
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.employee.id as string;
    const token = new URL(created.body.invite.inviteUrl).searchParams.get('token')!;
    expect((await http().post('/v1/invites/accept').send({ token, password: pw })).status).toBe(
      200,
    );

    const signIn = () => http().post('/v1/auth/sign-in/email').send({ email, password: pw });
    const me = (h: Record<string, string>) => http().get('/v1/me').set(h);
    const sessions = async () => {
      const s = await signIn();
      expect(s.status).toBe(200);
      const cookie = (s.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; ');
      return {
        bearer: { authorization: `Bearer ${s.headers['set-auth-token']}` },
        cookie: { cookie },
      };
    };
    const version = async () =>
      (await http().get('/v1/team').set({ authorization: director })).body.nodes.find(
        (n: { id: string }) => n.id === id,
      ).version as number;

    let v: number;
    // 1) Role change.
    let a = await sessions();
    expect((await me(a.bearer)).status).toBe(200);
    expect((await me(a.cookie)).status).toBe(200);
    v = await version();
    const role = await http()
      .patch(`/v1/employees/${id}`)
      .set({ authorization: director })
      .send({ version: v, role: 'area_business_manager', managerId: U.regional });
    expect(role.status, JSON.stringify(role.body)).toBe(200);
    expect((await me(a.bearer)).status).toBe(401);
    expect((await me(a.cookie)).status).toBe(401);

    // A non-role edit keeps sessions.
    a = await sessions();
    v = await version();
    const rename = await http()
      .patch(`/v1/employees/${id}`)
      .set({ authorization: director })
      .send({ version: v, name: `Rev ${RUN} b` });
    expect(rename.status).toBe(200);
    expect((await me(a.bearer)).status).toBe(200);

    // 2) Deactivation.
    v = await version();
    const off = await http()
      .patch(`/v1/employees/${id}`)
      .set({ authorization: director })
      .send({ version: v, status: 'suspended' });
    expect(off.status).toBe(200);
    expect((await me(a.bearer)).status).toBe(401);
    expect((await me(a.cookie)).status).toBe(401);
    const denied = await signIn();
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain('ACCOUNT_SUSPENDED');
    expect(denied.headers['set-auth-token']).toBeUndefined();

    // Reactivated: can sign in again.
    v = await version();
    const on = await http()
      .patch(`/v1/employees/${id}`)
      .set({ authorization: director })
      .send({ version: v, status: 'active' });
    expect(on.status).toBe(200);
    const back = await sessions();
    expect((await me(back.bearer)).status).toBe(200);
  });
});
