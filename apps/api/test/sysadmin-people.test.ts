import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID, T, U } from '@ariforce/db';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { TeamService } from '../src/team/team.service';
import type { Principal } from '../src/auth/principal';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const RUN = `pp${Date.now().toString(36)}`;

describe.skipIf(!OWNER || !APP)('System admin People page (list + edit)', () => {
  let app: INestApplication;
  let db: Pool;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  const id: Record<string, string> = {};
  const ver = async (uid: string) =>
    (await db.query<{ v: number }>('select version as v from users where id = $1', [uid])).rows[0]!
      .v;
  const patch = async (uid: string, b: Record<string, unknown>, who = 'sysadmin') =>
    http()
      .patch(`/v1/employees/${uid}`)
      .set(as(who))
      .send({ version: await ver(uid), ...b });
  const add = async (key: string, role: string, terr: string | null, managerId: string | null) => {
    const r = await http()
      .post('/v1/employees')
      .set(as('sysadmin'))
      .send({
        name: `${RUN} ${key}`,
        email: `${RUN}.${key}@demo.ariforce.in`,
        employeeCode: `${RUN}-${key}`,
        role,
        territoryIds: terr ? [terr] : [],
        managerId,
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    id[key] = r.body.employee.id;
  };
  const pending = async (requester: string, approver: string) => {
    const rid = randomUUID();
    await db.query(
      `insert into approval_requests (id, company_id, entity_type, entity_id, requested_by)
       values ($1, $2, 'leave', $3, $4)`,
      [rid, DEMO_COMPANY_ID, randomUUID(), requester],
    );
    await db.query(
      `insert into approval_steps (id, company_id, request_id, step_no, approver_user_id)
       values ($1, $2, $3, 1, $4)`,
      [randomUUID(), DEMO_COMPANY_ID, rid, approver],
    );
    return rid;
  };
  const approverOf = async (rid: string) =>
    (
      await db.query<{ a: string }>(
        'select approver_user_id as a from approval_steps where request_id = $1',
        [rid],
      )
    ).rows[0]!.a;

  beforeAll(async () => {
    process.env.INVITE_RETURN_LINK = 'true';
    db = new Pool({ connectionString: OWNER });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['director', 'abm', 'sysadmin']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
    await add('z', 'zonal_business_manager', T.zone, U.director);
    await add('r', 'regional_business_manager', T.region, id.z!);
    await add('a', 'area_business_manager', T.area, id.r!);
    await add('b', 'business_manager', T.hq, id.a!);
  });
  afterAll(async () => {
    delete process.env.INVITE_RETURN_LINK;
    await app?.close();
    await db?.end();
  });

  it('GET /v1/users returns every editable field, filters and stable cursor pages', async () => {
    const res = await http().get('/v1/users').query({ q: RUN, limit: 200 }).set(as('sysadmin'));
    expect(res.status).toBe(200);
    const b = res.body.items.find((u: { id: string }) => u.id === id.b);
    expect(b).toMatchObject({
      name: `${RUN} b`,
      email: `${RUN}.b@demo.ariforce.in`,
      employeeCode: `${RUN}-b`,
      roles: ['business_manager'],
      primaryRole: 'business_manager',
      rank: 1,
      managerId: id.a,
      managerName: `${RUN} a`,
      territoryIds: [T.hq],
      status: 'invited',
      hasLogin: false,
      inviteStatus: 'pending',
      lastActiveAt: null,
    });
    expect(b.territories[0]).toMatchObject({ id: T.hq, level: expect.any(String) });
    expect(typeof b.version).toBe('number');
    const q = (x: Record<string, string | number>) =>
      http().get('/v1/users').query(x).set(as('sysadmin'));
    expect((await q({ q: `${RUN}-z` })).body.items.map((u: { id: string }) => u.id)).toEqual([
      id.z,
    ]);
    expect(
      (await q({ q: RUN, role: 'regional_business_manager' })).body.items.map(
        (u: { id: string }) => u.id,
      ),
    ).toEqual([id.r]);
    const rep = (await q({ hasLogin: 'true', limit: 200 })).body.items;
    expect(rep.every((u: { hasLogin: boolean }) => u.hasLogin)).toBe(true);
    expect(rep.find((u: { id: string }) => u.id === U.rep)).toMatchObject({
      hasLogin: true,
      inviteStatus: 'accepted',
    });
    expect(
      (await q({ hasLogin: 'false', q: RUN })).body.items.every(
        (u: { hasLogin: boolean }) => !u.hasLogin,
      ),
    ).toBe(true);
    const sub = (await q({ territoryId: T.area, q: RUN })).body.items.map(
      (u: { id: string }) => u.id,
    );
    expect(sub.sort()).toEqual([id.a, id.b].sort());
    expect((await q({ status: 'invited', q: RUN })).body.items).toHaveLength(4);
    // Cursor pages (limit 2) cover every row exactly once, in name order.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const pg = await q({ q: RUN, limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...pg.body.items.map((u: { name: string }) => u.name));
      cursor = pg.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([`${RUN} a`, `${RUN} b`, `${RUN} r`, `${RUN} z`]);
    expect((await q({ limit: 201 })).status).toBe(422);
    // Non-admin stays scoped to its reporting line.
    const abm = await http().get('/v1/users').query({ limit: 200 }).set(as('abm'));
    expect(abm.body.items.map((u: { id: string }) => u.id)).not.toContain(U.otherRep);
  });

  it('edits all details of a person without a login; email change re-sends the invite; audited', async () => {
    const res = await patch(id.b!, {
      name: `${RUN} b2`,
      email: `${RUN}.b2@demo.ariforce.in`,
      employeeCode: `${RUN}-b2`,
      phone: '+919800000001',
      designation: 'Senior MR',
      joinedOn: '2026-01-15',
      territoryIds: [T.otherArea],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      name: `${RUN} b2`,
      email: `${RUN}.b2@demo.ariforce.in`,
      employeeCode: `${RUN}-b2`,
      designation: 'Senior MR',
      joinedOn: '2026-01-15',
    });
    const inv = await db.query<{ open: number; revoked: number }>(
      `select count(*) filter (where revoked_at is null and used_at is null)::int as open,
              count(*) filter (where revoked_at is not null)::int as revoked
       from user_invites where user_id = $1`,
      [id.b],
    );
    expect(inv.rows[0]).toEqual({ open: 1, revoked: 1 });
    const a = await db.query<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
      `select before, after from audit_log where entity_id = $1 and action = 'employee.updated'
       order by id desc limit 1`,
      [id.b],
    );
    expect(a.rows[0]!.before).toMatchObject({
      email: `${RUN}.b@demo.ariforce.in`,
      territoryIds: [T.hq],
    });
    expect(a.rows[0]!.after).toMatchObject({
      email: `${RUN}.b2@demo.ariforce.in`,
      territoryIds: [T.otherArea],
      roles: ['business_manager'],
    });
  });

  it('version, email and employee-code conflicts', async () => {
    const stale = await http()
      .patch(`/v1/employees/${id.b}`)
      .set(as('sysadmin'))
      .send({ version: 1, name: 'x' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const dupE = await patch(id.b!, { email: 'BM@demo.ariforce.in' });
    expect([dupE.status, dupE.body.error.code]).toEqual([409, 'EMAIL_TAKEN']);
    const dupC = await patch(id.b!, { employeeCode: 'BM001' });
    expect([dupC.status, dupC.body.error.code]).toEqual([409, 'EMPLOYEE_CODE_TAKEN']);
    const locked = await patch(U.rep, { email: `${RUN}.rep@demo.ariforce.in` });
    expect([locked.status, locked.body.error.code]).toEqual([409, 'EMAIL_LOCKED_HAS_LOGIN']);
  });

  it('reporting line rules: cycle, manager rank, reports outranking, kept manager', async () => {
    const cyc = await patch(id.z!, { managerId: id.b });
    expect(cyc.status).toBe(409);
    expect((await patch(id.r!, { managerId: U.rep })).status).toBe(403);
    const down = await patch(id.a!, { role: 'business_manager' });
    expect([down.status, down.body.error.code]).toEqual([422, 'REPORTS_OUTRANK']);
    const up = await patch(id.r!, { role: 'zonal_business_manager' });
    expect([up.status, up.body.error.code]).toEqual([422, 'MANAGER_RANK']);
    const ok = await patch(id.r!, { role: 'zonal_business_manager', managerId: U.sm });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ role: 'zonal_business_manager', managerId: U.sm });
    expect(
      (await patch(id.r!, { role: 'regional_business_manager', managerId: id.z })).status,
    ).toBe(200);
  });

  it('to and from functional roles and system_admin; territories may be empty', async () => {
    expect((await patch(id.b!, { territoryIds: [] })).status).toBe(422);
    const fn = await patch(id.b!, { role: 'accountant', territoryIds: [] });
    expect(fn.status, JSON.stringify(fn.body)).toBe(200);
    expect(fn.body).toMatchObject({ roles: ['accountant'], managerId: null, territories: [] });
    expect((await patch(id.b!, { managerId: id.a })).status).toBe(422);
    expect((await patch(id.b!, { role: 'system_admin' })).status).toBe(200);
    expect((await patch(id.b!, { role: 'business_manager' })).status).toBe(422);
    const back = await patch(id.b!, {
      role: 'business_manager',
      territoryIds: [T.hq],
      managerId: id.a,
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body).toMatchObject({ role: 'business_manager', managerId: id.a });
    const dir = await patch(id.z!, { role: 'director' });
    expect(dir.status, JSON.stringify(dir.body)).toBe(200);
    expect(dir.body.managerId).toBeNull();
    expect(
      (await patch(id.z!, { role: 'zonal_business_manager', managerId: U.director })).status,
    ).toBe(200);
  });

  it('pending approvals follow a manager change and leave a deactivated approver', async () => {
    const r1 = await pending(id.b!, id.a!);
    expect((await patch(id.b!, { managerId: id.r })).status).toBe(200);
    expect(await approverOf(r1)).toBe(id.r);
    const r2 = await pending(id.a!, id.r!);
    expect((await patch(id.r!, { status: 'suspended' })).status).toBe(200);
    expect(await approverOf(r2)).toBe(id.z);
    expect(await approverOf(r1)).toBe(id.z);
    const a = await db.query(
      `select 1 from audit_log where entity_id = $1 and action = 'approval.steps_reassigned'`,
      [id.r],
    );
    expect(a.rowCount).toBeGreaterThan(0);
  });

  it('self-edit is blocked and the last active system admin is protected', async () => {
    expect((await patch(U.sysadmin, { name: 'me' })).status).toBe(403);
    // Service-level check with a second admin principal while every other admin is inactive.
    const others = await db.query<{ id: string }>(
      `select u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
       where u.company_id = $1 and r.key = 'system_admin' and u.status = 'active' and u.id <> $2`,
      [DEMO_COMPANY_ID, U.sysadmin],
    );
    const ids = others.rows.map((r) => r.id);
    if (ids.length)
      await db.query(`update users set status = 'suspended' where id = any($1)`, [ids]);
    try {
      const p = {
        authUserId: 'x',
        sessionId: 'x',
        userId: U.dh,
        companyId: DEMO_COMPANY_ID,
        roles: ['system_admin'],
        permissions: ['users:write'],
        territoryIds: [],
        scopePaths: null,
        teamUserIds: null,
        requestId: randomUUID(),
        ip: null,
      } as unknown as Principal;
      const svc = app.get(TeamService);
      for (const b of [{ role: 'accountant' as const }, { status: 'suspended' as const }])
        await expect(
          svc.update(p, U.sysadmin, { version: await ver(U.sysadmin), ...b }),
        ).rejects.toMatchObject({ response: { code: 'LAST_SYSTEM_ADMIN' } });
    } finally {
      if (ids.length)
        await db.query(`update users set status = 'active' where id = any($1)`, [ids]);
    }
  });

  it('non-admin rules unchanged', async () => {
    const abmPatch = (uid: string, b: Record<string, unknown>) => patch(uid, b, 'abm');
    expect((await abmPatch(U.rep, { email: `${RUN}.x@demo.ariforce.in` })).status).toBe(403);
    expect((await abmPatch(U.rep, { employeeCode: `${RUN}-x` })).status).toBe(403);
    expect((await abmPatch(U.rep, { role: 'accountant' })).status).toBe(403);
    expect((await abmPatch(U.rep, { managerId: null })).status).toBe(422);
    expect((await abmPatch(U.rep, { territoryIds: [] })).status).toBe(422);
    expect((await abmPatch(U.rep, { territoryIds: [T.otherArea] })).status).toBe(403);
    expect((await abmPatch(U.otherRep, { name: 'x' })).status).toBe(403);
    expect((await patch(id.a!, { name: 'x' }, 'director')).status).toBe(200);
    expect((await patch(id.a!, { role: 'accountant' }, 'director')).status).toBe(403);
    expect((await abmPatch(U.rep, { designation: 'Medical Representative' })).status).toBe(200);
  });
});
