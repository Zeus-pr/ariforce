import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
import { bearerFor, insertStaff } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const RUN = Date.now().toString(36);

/** Part 3: a BM holds headquarter-level territories only; ABM and above any level (writes only). */
describe.skipIf(!OWNER || !APP)('territory levels per role (real API)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const tok: Record<string, string> = {};
  const as = (who: string) => ({ authorization: tok[who]! });
  let n = 0;
  const emp = (role: string, territoryIds: string[], over: Record<string, unknown> = {}) => ({
    name: `${RUN} ${role}`,
    email: `lvl.${RUN}.${n++}@example.test`,
    role,
    territoryIds,
    ...over,
  });
  const invalid = (r: request.Response, ids: string[]) => {
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error).toMatchObject({
      code: 'TERRITORY_LEVEL_INVALID',
      details: { territoryIds: ids, expectedLevel: 'headquarter' },
    });
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['sysadmin', 'director', 'rbm', 'abm'])
      tok[who] = await bearerFor(http, who, PASSWORD);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('create: BM on an area is refused for every caller; on a headquarter it is fine', async () => {
    for (const who of ['sysadmin', 'director', 'rbm'])
      invalid(
        await http()
          .post('/v1/employees')
          .set(as(who))
          .send(emp('business_manager', [T.hq, T.area], { managerId: U.area })),
        [T.area],
      );
    const ok = await http()
      .post('/v1/employees')
      .set(as('rbm'))
      .send(emp('business_manager', [T.hq], { managerId: U.area }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const abm = await http()
      .post('/v1/employees')
      .set(as('rbm'))
      .send(emp('area_business_manager', [T.area], { managerId: U.regional }));
    expect(abm.status, JSON.stringify(abm.body)).toBe(201);
    const abmHq = await http()
      .post('/v1/employees')
      .set(as('rbm'))
      .send(emp('area_business_manager', [T.hq], { managerId: U.regional }));
    expect(abmHq.status, 'ABM may hold a headquarter too').toBe(201);
    const admin = await http()
      .post('/v1/employees')
      .set(as('sysadmin'))
      .send(emp('system_admin', [T.national]));
    expect(admin.status, 'system admin may hold any territory').toBe(201);
  });

  it('invite-bulk reports the row with TERRITORY_LEVEL_INVALID', async () => {
    const r = await http()
      .post('/v1/employees/invite-bulk')
      .set(as('sysadmin'))
      .send({
        employees: [
          emp('business_manager', [T.region], { managerId: U.area }),
          emp('business_manager', [T.hq], { managerId: U.area }),
        ],
      });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(['failed', 'invited']);
    expect(r.body.results[0].code).toBe('TERRITORY_LEVEL_INVALID');
  });

  it('PATCH: role change and territory change are checked; unrelated edits of legacy data pass', async () => {
    // Legacy shape: a BM already holding an area (created before the rule).
    const legacy = await insertStaff(`lvl-legacy-${RUN}@example.test`, 'business_manager', U.area, [
      T.area,
    ]);
    const get = async (uid = legacy.id) => {
      const pool = new Pool({ connectionString: OWNER, max: 1 });
      try {
        return (await pool.query(`select version from users where id = $1`, [uid])).rows[0] as {
          version: number;
        };
      } finally {
        await pool.end();
      }
    };
    let cur = await get();
    let r = await http()
      .patch(`/v1/employees/${legacy.id}`)
      .set(as('sysadmin'))
      .send({ version: cur.version, phone: '9000000001' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    cur = await get();
    invalid(
      await http()
        .patch(`/v1/employees/${legacy.id}`)
        .set(as('sysadmin'))
        .send({ version: cur.version, territoryIds: [T.otherArea] }),
      [T.otherArea],
    );
    r = await http()
      .patch(`/v1/employees/${legacy.id}`)
      .set(as('sysadmin'))
      .send({ version: cur.version, territoryIds: [T.hq] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    // Role change down to BM while holding an area is refused.
    const abm = await insertStaff(
      `lvl-abm-${RUN}@example.test`,
      'area_business_manager',
      U.regional,
      [T.otherArea],
    );
    const a = await get(abm.id);
    invalid(
      await http()
        .patch(`/v1/employees/${abm.id}`)
        .set(as('sysadmin'))
        .send({ version: a.version, role: 'business_manager', managerId: U.area }),
      [T.otherArea],
    );
  });

  it('GET /v1/territories?assignableForRole= and level= filter the picker', async () => {
    const bm = await http()
      .get('/v1/territories?assignableForRole=business_manager&limit=200')
      .set(as('director'));
    expect(bm.status, JSON.stringify(bm.body)).toBe(200);
    expect(bm.body.items.length).toBeGreaterThan(0);
    expect(new Set(bm.body.items.map((t: { level: string }) => t.level))).toEqual(
      new Set(['headquarter']),
    );
    const abm = await http()
      .get('/v1/territories?assignableForRole=area_business_manager&limit=200')
      .set(as('director'));
    expect(abm.body.items.map((t: { id: string }) => t.id)).toContain(T.area);
    const hq = await http().get('/v1/territories?level=headquarter&limit=200').set(as('director'));
    expect(hq.body.items.every((t: { level: string }) => t.level === 'headquarter')).toBe(true);
    expect(
      (await http().get('/v1/territories?assignableForRole=nope').set(as('director'))).status,
    ).toBe(422);
  });
});
