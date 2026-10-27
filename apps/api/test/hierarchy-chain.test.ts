import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
import { bearerFor, insertStaff } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const RUN = Date.now().toString(36);
const M = '2029-05'; // this suite's own tour-plan month
const NEXT = new Date().getUTCFullYear() + 1;
let monday = `${NEXT}-04-01`;
const addDay = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = addDay(monday, 1);

/**
 * No VP / GM / Sales Manager: BM -> ABM -> RBM -> ZBM -> Director, plus skipped ranks
 * (BM -> RBM, ZBM -> Director). Fresh people so the seed's reporting line is untouched.
 */
describe.skipIf(!OWNER || !APP)('hierarchy with skipped ranks (real API)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const as = (who: string) => ({ authorization: tok[who]! });
  let week = 0;
  const leave = async (who: string) => {
    const from = addDay(monday, 7 * week++);
    const r = await http()
      .post('/v1/leave/requests')
      .set(as(who))
      .send({ typeCode: 'CL', fromDate: from, toDate: from, reason: 'chain' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; approvalRequestId?: string };
  };
  const decide = (who: string, leaveId: string) =>
    http()
      .post(`/v1/leave/requests/${leaveId}/decision`)
      .set(as(who))
      .send({ decision: 'approve' });
  const steps = async (leaveId: string) => {
    const r = await http().get(`/v1/leave/requests/${leaveId}`).set(as('director'));
    return r.body;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['director', 'sysadmin']) tok[who] = await bearerFor(http, who, PASSWORD);
    id.director = U.director;
    const add = async (who: string, role: string, mgr: string, terr: string[] = []) => {
      const s = await insertStaff(`chain-${who}-${RUN}@example.test`, role, mgr, terr);
      id[who] = s.id;
      tok[who] = s.bearer;
    };
    await add('zbm', 'zonal_business_manager', U.director, [T.zone]); // skips VP/GM/SM
    await add('rbm', 'regional_business_manager', id.zbm!, [T.region]);
    await add('abm', 'area_business_manager', id.rbm!, [T.area]);
    await add('bm', 'business_manager', id.abm!, [T.hq]); // full line
    await add('bmx', 'business_manager', id.rbm!, [T.hq]); // skips ABM
    const s = await http()
      .put('/v1/leave/settings')
      .set(as('director'))
      .send({ maxFutureDays: 731, approvalLevels: 2, backdateDays: 14, weeklyOffDays: [0] });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('leave, two levels: the RBM (above the ABM step) approving early finishes it', async () => {
    const l = await leave('bm');
    const r = await decide('rbm', l.id);
    expect(r.body.status, 'no second step queued for the RBM who already decided').toBe('approved');
  });

  it('leave, two levels, step by step: ABM then RBM', async () => {
    const l = await leave('bm');
    let r = await decide('abm', l.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('pending');
    expect((await decide('abm', l.id)).status).toBe(403);
    r = await decide('rbm', l.id);
    expect(r.body.status).toBe('approved');
  });

  it('leave with a skipped rank: BM -> RBM, second level is the ZBM', async () => {
    const l = await leave('bmx');
    expect((await decide('abm', l.id)).status, 'ABM is not in this line').toBe(404);
    let r = await decide('rbm', l.id);
    expect(r.body.status).toBe('pending');
    r = await decide('zbm', l.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('approved');
  });

  it('leave when the manager is the director: one step, nothing stuck', async () => {
    const l = await leave('zbm');
    const r = await decide('director', l.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('approved');
  });

  it("leave when the manager's manager is the director (RBM -> ZBM -> Director)", async () => {
    const l = await leave('rbm');
    let r = await decide('zbm', l.id);
    expect(r.body.status).toBe('pending');
    r = await decide('director', l.id);
    expect(r.body.status).toBe('approved');
  });

  it('director sees, reads and decides any approval company-wide; early decision is final', async () => {
    const l = await leave('bm');
    const list = await http()
      .get('/v1/approvals?mine=to_decide&subjectType=leave&limit=100')
      .set(as('director'));
    const a = list.body.items.find((x: { subjectId: string }) => x.subjectId === l.id);
    expect(a, 'director queue holds the BM request').toBeTruthy();
    expect(a.approverId).toBe(id.abm);
    const one = await http().get(`/v1/approvals/${a.id}`).set(as('director'));
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body.subject).toBeTruthy();
    const r = await http()
      .post(`/v1/approvals/${a.id}/decision`)
      .set(as('director'))
      .send({ decision: 'approve' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('approved');
    void steps;
  });

  it('tour plan submission with a skipped rank goes to the RBM; director can decide it too', async () => {
    const wt = await http().get('/v1/work-types?limit=50').set(as('bmx'));
    const field = wt.body.items.find((w: { kind: string }) => w.kind === 'field');
    const day = (date: string) => ({
      date,
      entries: [{ session: 'full', workTypeId: field.id, territoryIds: [T.hq], notes: 'P' }],
    });
    let r = await http()
      .put(`/v1/tour-plans/${M}`)
      .set(as('bmx'))
      .send({ days: [day(`${M}-07`), day(`${M}-08`)] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await http()
      .post(`/v1/tour-plans/${M}/submit`)
      .set(as('bmx'))
      .send({ dates: [`${M}-07`] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const a1 = r.body.submissions[0].approvalId as string;
    let g = await http().get(`/v1/approvals/${a1}`).set(as('rbm'));
    expect(g.status).toBe(200);
    expect(g.body.approverId).toBe(id.rbm);
    expect((await http().get(`/v1/approvals/${a1}`).set(as('abm'))).status).toBe(404);
    r = await http()
      .post(`/v1/approvals/${a1}/decision`)
      .set(as('rbm'))
      .send({ decision: 'approve' });
    expect(r.body.status).toBe('approved');

    r = await http()
      .post(`/v1/tour-plans/${M}/submit`)
      .set(as('bmx'))
      .send({ dates: [`${M}-08`] });
    const a2 = r.body.submissions[1].approvalId as string;
    g = await http().get(`/v1/approvals/${a2}`).set(as('director'));
    expect(g.status).toBe(200);
    r = await http()
      .post(`/v1/approvals/${a2}/decision`)
      .set(as('director'))
      .send({ decision: 'approve' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('approved');
  });

  it('manager must outrank, ranks may be skipped (team/{id}/manager)', async () => {
    const set = (who: string, managerId: string) =>
      http().post(`/v1/team/${id[who]}/manager`).set(as('sysadmin')).send({ managerId });
    let r = await set('bmx', U.director); // BM straight to the director
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await set('bmx', id.zbm!); // BM -> ZBM
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await set('zbm', U.area); // a lower rank (seed ABM) may not manage a ZBM
    expect(r.status).toBe(403);
    r = await set('zbm', id.abm!); // own report as manager: a cycle
    expect(r.status).toBe(409);
    r = await set('bmx', id.rbm!);
    expect(r.status).toBe(200);
  });
});
