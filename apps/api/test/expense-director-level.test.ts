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
const MONTH = `${1981 + (Date.now() % 15)}-06`;

/**
 * EXPENSE_APPROVAL_LEVELS=3: manager, their manager, then always the Director. The level count is
 * read when the app boots, so this suite sets it before compiling the module.
 */
describe.skipIf(!OWNER || !APP)('expense approval, Director as level 3 (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const saved = process.env.EXPENSE_APPROVAL_LEVELS;
  const http = () => request(app.getHttpServer());
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const as = (who: string) => ({ authorization: tok[who]! });

  const claim = async (who: string) => {
    const c = await http().post('/v1/expense-claims').set(as(who)).send({ month: MONTH });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    await owner.query(
      `insert into dcrs (id, company_id, user_id, date, work_type_id, status)
       select gen_random_uuid(), u.company_id, u.id, $2, wt.id, 'approved'
       from users u join work_types wt on wt.company_id = u.company_id
       where u.id = $1 and wt.counts_as_field_day limit 1`,
      [id[who], `${MONTH}-03`],
    );
    await http()
      .post(`/v1/expense-claims/${c.body.id}/lines`)
      .set(as(who))
      .send({ date: `${MONTH}-03`, category: 'travel', amount: 100, notes: 'bus' });
    const s = await http().post(`/v1/expense-claims/${c.body.id}/submit`).set(as(who));
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    return c.body.id as string;
  };
  const dec = (who: string, cid: string) =>
    http().post(`/v1/expense-claims/${cid}/decision`).set(as(who)).send({ decision: 'approve' });
  const trail = async (cid: string) =>
    (await http().get(`/v1/expense-claims/${cid}`).set(as('director'))).body;

  beforeAll(async () => {
    process.env.EXPENSE_APPROVAL_LEVELS = '3';
    owner = new Pool({ connectionString: OWNER });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    tok.director = await bearerFor(http, 'director', PASSWORD);
    id.director = U.director;
    const add = async (who: string, role: string, mgr: string, terr: string[] = []) => {
      const s = await insertStaff(`dl3-${who}-${RUN}@example.test`, role, mgr, terr);
      id[who] = s.id;
      tok[who] = s.bearer;
    };
    await add('rbm', 'regional_business_manager', U.director, [T.region]);
    await add('abm', 'area_business_manager', id.rbm!, [T.area]);
    for (const b of ['bm', 'bmRbm', 'bmDir']) await add(b, 'business_manager', id.abm!, [T.hq]);
    await add('bmx', 'business_manager', id.rbm!, [T.hq]); // skips the ABM
  });
  afterAll(async () => {
    if (saved === undefined) delete process.env.EXPENSE_APPROVAL_LEVELS;
    else process.env.EXPENSE_APPROVAL_LEVELS = saved;
    await owner?.end();
    await app?.close();
  });

  it('BM -> ABM -> RBM -> Director: three steps, the Director decides last', async () => {
    const c = await claim('bm');
    expect((await trail(c)).totalLevels).toBe(3);
    expect((await dec('abm', c)).body.status).toBe('submitted');
    expect((await dec('rbm', c)).body.status, 'RBM is level 2, not the end').toBe('submitted');
    const t = await trail(c);
    expect(t.currentApprover?.id).toBe(id.director);
    expect((await dec('director', c)).body.status).toBe('approved');
  });

  it('a manager above the current step approving early still leaves the Director', async () => {
    const c = await claim('bmRbm');
    expect((await dec('rbm', c)).body.status).toBe('submitted');
    expect((await trail(c)).currentApprover?.id).toBe(id.director);
    expect((await dec('director', c)).body.status).toBe('approved');
  });

  it('the Director approving at any step finishes it', async () => {
    const c = await claim('bmDir');
    expect((await dec('director', c)).body.status).toBe('approved');
  });

  it('BM -> RBM (skips ABM): RBM then Director, no duplicate Director step', async () => {
    const c = await claim('bmx');
    expect((await dec('rbm', c)).body.status).toBe('submitted');
    expect((await dec('director', c)).body.status).toBe('approved');
  });
});
