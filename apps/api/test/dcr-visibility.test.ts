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
const RUN = Date.now().toString(36);
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';

/**
 * GET /v1/dcrs/{id} and GET /v1/dcrs?userId= visibility: a BM reads only their own DCRs (another
 * person's id is 404, never 403, so ids are not confirmed); managers read their subtree; the
 * Director reads everyone's; System Admin has field:read (outlet locks) but no sales line, so a
 * BM's DCR by id is 404 (not 403).
 */
describe.skipIf(!OWNER || !APP)('DCR read visibility (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  let dcrId = '';
  const http = () => request(app.getHttpServer());
  const today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    for (const who of ['director', 'sysadmin'])
      tok[who] = await bearerFor(http as never, who, PASSWORD);
    const add = async (who: string, role: string, mgr: string, terr: string[]) => {
      const s = await insertStaff(`dcr-vis-${who}-${RUN}@example.test`, role, mgr, terr);
      id[who] = s.id;
      tok[who] = s.bearer;
    };
    await add('rbm', 'regional_business_manager', U.director, [T.region]);
    await add('abm', 'area_business_manager', id.rbm!, [T.area]);
    await add('bm', 'business_manager', id.abm!, [T.hq]);
    await add('peer', 'business_manager', id.abm!, [T.hq]);
    await add('otherAbm', 'area_business_manager', id.rbm!, [T.area]);
    const o = await http()
      .get(`/v1/dcrs/options?date=${today}&products=false`)
      .set({ authorization: tok.bm! });
    const wt = (o.body.workTypes as { id: string; detailsKind: string | null }[]).find(
      (w) => w.detailsKind === 'meeting',
    )!.id;
    const d = await http()
      .put('/v1/dcrs/draft')
      .set({ authorization: tok.bm! })
      .send({
        date: today,
        workTypeId: wt,
        details: {
          kind: 'meeting',
          title: 'Cycle Meeting',
          mode: 'online',
          startTime: '10:00',
          endTime: '11:00',
        },
      });
    expect(d.status).toBe(200);
    dcrId = d.body.id;
  });
  afterAll(async () => {
    const ids = Object.values(id);
    if (ids.length) await owner.query(`delete from dcrs where user_id = any($1)`, [ids]);
    await owner?.end();
    await app?.close();
  });

  const byId = (who: string) => http().get(`/v1/dcrs/${dcrId}`).set({ authorization: tok[who]! });
  const list = (who: string) =>
    http()
      .get(`/v1/dcrs?userId=${id.bm}&from=${today}&to=${today}`)
      .set({ authorization: tok[who]! });

  it('owner, manager chain and Director read it by id', async () => {
    for (const who of ['bm', 'abm', 'rbm', 'director']) {
      const r = await byId(who);
      expect([who, r.status, r.body.id]).toEqual([who, 200, dcrId]);
    }
  });

  it("a BM cannot read another person's DCR by id: 404 (not 403)", async () => {
    const r = await byId('peer');
    expect(r.status).toBe(404);
    expect(r.body.id).toBeUndefined();
    // An ABM outside the person's line is the same 404.
    expect((await byId('otherAbm')).status).toBe(404);
  });

  it('System Admin has field:read but no sales line: BM DCR by id is 404', async () => {
    expect((await byId('sysadmin')).status).toBe(404);
  });

  it('list with userId: Director sees it; a peer BM never does; an ABM outside the line 403', async () => {
    const d = await list('director');
    expect(d.status).toBe(200);
    expect((d.body.items as { id: string }[]).map((x) => x.id)).toContain(dcrId);
    // A BM's list is always their own DCRs (userId is ignored), so the peer's DCR never shows.
    const p = await list('peer');
    expect(p.status).toBe(200);
    expect((p.body.items as { id: string }[]).map((x) => x.id)).not.toContain(dcrId);
    // A manager asking for someone outside their subtree gets 403 (userFilter).
    expect((await list('otherAbm')).status).toBe(403);
  });
});
