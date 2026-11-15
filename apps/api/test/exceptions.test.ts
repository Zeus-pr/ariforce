import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID as A, U } from '@ariforce/db';
import { bearerFor } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { JobsRunner } from '../src/jobs/jobs.runner';
import { JobsService } from '../src/jobs/jobs.service';
import { render } from '../src/notifications/templates';
import { datesBetween } from '../src/exceptions/exceptions.engine';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const addDay = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
// Far past, offset per run so re-runs on one DB do not overlap.
const Y = 1960 + (Date.now() % 30);
let MON = `${Y}-03-02`;
while (dow(MON) !== 1) MON = addDay(MON, 1);
const D = (n: number) => addDay(MON, n);
const APR_FROM = `${Y}-04-25`;
const APR_TO = `${Y}-04-30`;
const BM = U.rep;
const BM2 = U.otherRep;
const FIELD_WT = '01930000-0000-7000-8000-900000000001';
const MEETING_WT = '01930000-0000-7000-8000-900000000004';
const HOLIDAY_WT = '01930000-0000-7000-8000-900000000007';
const DOCTOR = '01930000-0000-7000-8000-600000000001';

describe('exception units', () => {
  it('digest text', () => {
    expect(render('exceptions.digest', { total: 3, high: 1, from: 'a', to: 'b' })).toEqual({
      title: 'Team exceptions need attention',
      body: '3 new exceptions in your team (1 high) for a to b.',
    });
    expect(render('exceptions.digest', { total: 1 }).body).toBe('1 new exception in your team.');
  });
  it('datesBetween is inclusive', () => {
    expect(datesBetween('2020-02-28', '2020-03-01')).toEqual([
      '2020-02-28',
      '2020-02-29',
      '2020-03-01',
    ]);
  });
});

type Ex = {
  id: string;
  ruleCode: string;
  status: string;
  periodDate: string;
  severity: string;
  value: number | null;
  autoResolved: boolean;
  user: { id: string };
  assignee: { id: string } | null;
  suggestedAction: string;
  version: number;
};

describe.skipIf(!OWNER || !APP)('exceptions (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  let runner: JobsRunner;
  let device: string;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  const drain = async () => {
    while ((await runner.runOnce(50)) > 0);
  };
  const evaluate = async (from: string, to: string) => {
    const r = await http().post('/v1/exceptions/evaluate').set(as('director')).send({ from, to });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    await drain();
  };
  const list = async (who: string, q: Record<string, string> = {}) => {
    const r = await http()
      .get('/v1/exceptions')
      .query({ from: D(0), to: D(3), limit: 200, ...q })
      .set(as(who));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.items as Ex[];
  };
  const find = async (user: string, rule: string, date: string) =>
    (await list('director', { userId: user, from: date, to: date, ruleCode: rule }))[0];
  const dcr = (user: string, d: string, wt: string, submittedAt: string | null) =>
    owner.query(
      `insert into dcrs (id, company_id, user_id, date, work_type_id, status, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [uuidv7(), A, user, d, wt, submittedAt ? 'submitted' : 'draft', submittedAt],
    );
  const call = (dcrId: string, user: string, d: string) =>
    owner.query(
      `insert into dcr_calls (id, company_id, dcr_id, user_id, date, outlet_kind, outlet_id)
       values ($1, $2, $3, $4, $5, 'doctor', $6)`,
      [uuidv7(), A, dcrId, user, d, DOCTOR],
    );
  const capture = (user: string, d: string, kind: string, o: { distance?: number } = {}) =>
    owner.query(
      `insert into geo_captures (id, company_id, user_id, device_id, kind, location, source, captured_at, entity_type, entity_id, distance_m)
       values ($1, $2, $3, $4, $5, 'SRID=4326;POINT(88.37 22.6)', 'gps', $6, $7, $8, $9)`,
      [
        uuidv7(),
        A,
        user,
        device,
        kind,
        `${d}T10:00:00+05:30`,
        kind === 'visit' ? 'doctor' : null,
        kind === 'visit' ? DOCTOR : null,
        o.distance ?? null,
      ],
    );

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    runner = app.get(JobsRunner);
    owner = new Pool({ connectionString: OWNER });
    for (const who of ['bm', 'bm2', 'abm', 'rbm', 'director', 'sysadmin', 'accountant', 'dh']) {
      tok[who] = await bearerFor(http, who, PASSWORD);
    }
    device = uuidv7();
    await owner.query(
      `insert into devices (id, company_id, user_id, ownership, platform, install_id)
       values ($1, $2, $3, 'company', 'android', $4)`,
      [device, A, BM, `exc-${device}`],
    );
    await owner.query(`delete from exception_rules where company_id = $1`, [A]);
    // Keep unrelated queued jobs from earlier suites out of the way.
    await owner.query(
      `update jobs set run_at = now() + interval '1 day' where status = 'queued' and type <> 'notify'`,
    );
    // bm: D0 nothing; D1 punch only; D2 field DCR on time with 2 calls + punch + 1 out-of-fence visit;
    // D3 meeting DCR submitted 5 days late + punch. bm2: holiday DCRs on time (no exceptions).
    await capture(BM, D(1), 'punch_in');
    const d2 = (await dcr(BM, D(2), FIELD_WT, `${D(2)}T18:00:00+05:30`)).rows[0].id;
    await call(d2, BM, D(2));
    await call(d2, BM, D(2));
    await capture(BM, D(2), 'punch_in');
    await capture(BM, D(2), 'visit', { distance: 5000 });
    await dcr(BM, D(3), MEETING_WT, `${D(5)}T18:00:00+05:30`);
    await capture(BM, D(3), 'punch_in');
    for (let i = 0; i < 4; i++) await dcr(BM2, D(i), HOLIDAY_WT, `${D(i)}T18:00:00+05:30`);
  });
  afterAll(async () => {
    const users = [BM, BM2];
    await owner.query(
      `delete from exceptions where user_id = any($1::uuid[]) and period_date between $2 and $3`,
      [users, `${Y}-01-01`, `${Y}-12-31`],
    );
    // geo_captures are append-only evidence (DPDP), so the device and its captures stay.
    await owner.query(
      `delete from dcr_calls where user_id = any($1::uuid[]) and date between $2 and $3`,
      [users, `${Y}-01-01`, `${Y}-12-31`],
    );
    await owner.query(
      `delete from dcrs where user_id = any($1::uuid[]) and date between $2 and $3`,
      [users, `${Y}-01-01`, `${Y}-12-31`],
    );
    await owner.query(
      `delete from tour_plan_submissions where tour_plan_id in (select id from tour_plans where user_id = any($1::uuid[]) and month = $2)`,
      [users, `${Y}-05-01`],
    );
    await owner.query(`delete from tour_plans where user_id = any($1::uuid[]) and month = $2`, [
      users,
      `${Y}-05-01`,
    ]);
    await owner.query(`delete from exception_rules where company_id = $1`, [A]);
    await owner.query(`update jobs set run_at = now() where status = 'queued' and run_at > now()`);
    await owner?.end();
    await app?.close();
  });

  it('evaluates each day rule; context, severity, suggested action, default assignee', async () => {
    await evaluate(D(0), D(3));
    const mine = await list('director', { userId: BM });
    const got = mine.map((e) => `${e.periodDate}:${e.ruleCode}`).sort();
    expect(got).toEqual(
      [
        `${D(0)}:dcr_missing`,
        `${D(1)}:punch_without_dcr`,
        `${D(2)}:geofence_breach`,
        `${D(2)}:low_call_average`,
        `${D(3)}:dcr_late`,
      ].sort(),
    );
    expect(await list('director', { userId: BM2 })).toEqual([]);
    const low = mine.find((e) => e.ruleCode === 'low_call_average')!;
    expect(low).toMatchObject({ severity: 'medium', value: 2, status: 'open' });
    expect(low.assignee?.id).toBe(U.area);
    expect(low.suggestedAction).toMatch(/joint working/);
    // Sorted by severity first.
    expect(mine[0]!.severity).toBe('high');
    expect(mine.at(-1)!.ruleCode).toBe('dcr_late');
  });

  it('re-running is idempotent (same rows, same versions)', async () => {
    const before = await list('director', { userId: BM });
    await evaluate(D(0), D(3));
    const after = await list('director', { userId: BM });
    expect(after.map((e) => [e.id, e.version])).toEqual(before.map((e) => [e.id, e.version]));
  });

  it('auto-resolves when the condition clears and reopens when it comes back', async () => {
    const late = await dcr(BM, D(0), FIELD_WT, `${D(4)}T09:00:00+05:30`);
    for (let i = 0; i < 9; i++) await call(late.rows[0].id, BM, D(0));
    await evaluate(D(0), D(0));
    const missing = await find(BM, 'dcr_missing', D(0));
    expect(missing).toMatchObject({ status: 'resolved', autoResolved: true });
    expect((await find(BM, 'dcr_late', D(0)))?.status).toBe('open');
    await owner.query(`update dcrs set deleted_at = now() where id = $1`, [late.rows[0].id]);
    await evaluate(D(0), D(0));
    expect(await find(BM, 'dcr_missing', D(0))).toMatchObject({
      id: missing!.id,
      status: 'open',
      autoResolved: false,
    });
    expect((await find(BM, 'dcr_late', D(0)))?.status).toBe('resolved');
  });

  it('scope matrix', async () => {
    const all = await list('director', { userId: BM });
    const id = all[0]!.id;
    expect((await list('bm')).every((e) => e.user.id === BM)).toBe(true);
    expect((await list('bm')).length).toBeGreaterThan(0);
    expect(await list('bm2')).toEqual([]);
    expect((await list('abm', { userId: BM })).length).toBe(all.length);
    expect((await list('rbm', { userId: BM })).length).toBe(all.length);
    expect((await http().get(`/v1/exceptions/${id}`).set(as('bm2'))).status).toBe(404);
    expect((await http().get(`/v1/exceptions/${id}`).set(as('abm'))).status).toBe(200);
    expect((await http().get(`/v1/exceptions/not-a-uuid`).set(as('abm'))).status).toBe(404);
    // system_admin has field:read (0061) so list is allowed, but not company-wide — BM row is 404.
    expect((await http().get('/v1/exceptions').set(as('sysadmin'))).status).toBe(200);
    expect((await http().get(`/v1/exceptions/${id}`).set(as('sysadmin'))).status).toBe(404);
    for (const who of ['accountant', 'dh']) {
      expect((await http().get('/v1/exceptions').set(as(who))).status).toBe(403);
      expect((await http().get(`/v1/exceptions/${id}`).set(as(who))).status).toBe(403);
    }
  });

  it('lifecycle: explain, assign + follow-up, resolve, dismiss; closed rows survive re-runs', async () => {
    const low = (await find(BM, 'low_call_average', D(2)))!;
    const geo = (await find(BM, 'geofence_breach', D(2)))!;
    const note = { note: 'Doctor clinic closed for renovation' };
    expect(
      (await http().post(`/v1/exceptions/${low.id}/explain`).set(as('abm')).send(note)).status,
    ).toBe(403);
    const ex = await http().post(`/v1/exceptions/${low.id}/explain`).set(as('bm')).send(note);
    expect(ex.status, JSON.stringify(ex.body)).toBe(200);
    expect(ex.body).toMatchObject({ status: 'acknowledged', explanation: note.note });
    expect(
      (await http().post(`/v1/exceptions/${low.id}/resolve`).set(as('bm')).send(note)).status,
    ).toBe(403);
    expect(
      (await http().post(`/v1/exceptions/${low.id}/resolve`).set(as('abm')).send({ note: '' }))
        .status,
    ).toBe(422);
    const bad = await http()
      .patch(`/v1/exceptions/${low.id}`)
      .set(as('abm'))
      .send({ assigneeId: BM2 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('ASSIGNEE_OUT_OF_SCOPE');
    const stale = await http()
      .patch(`/v1/exceptions/${low.id}`)
      .set(as('abm'))
      .send({ followUpOn: D(10), version: 1 });
    expect(stale.status).toBe(409);
    const asg = await http()
      .patch(`/v1/exceptions/${low.id}`)
      .set(as('abm'))
      .send({ assigneeId: BM, followUpOn: D(10), version: ex.body.version });
    expect(asg.status, JSON.stringify(asg.body)).toBe(200);
    expect(asg.body).toMatchObject({ assignee: { id: BM }, followUpOn: D(10) });
    expect((await list('bm', { assignedToMe: 'true' })).map((e) => e.id)).toContain(low.id);
    const res = await http()
      .post(`/v1/exceptions/${low.id}/resolve`)
      .set(as('abm'))
      .send({ note: 'Discussed, joint work planned' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'resolved',
      autoResolved: false,
      resolvedBy: { id: U.area },
    });
    expect(
      (await http().post(`/v1/exceptions/${low.id}/resolve`).set(as('abm')).send(note)).status,
    ).toBe(409);
    expect(
      (await http().post(`/v1/exceptions/${low.id}/explain`).set(as('bm')).send(note)).status,
    ).toBe(409);
    const dis = await http()
      .post(`/v1/exceptions/${geo.id}/dismiss`)
      .set(as('rbm'))
      .send({ note: 'Outlet location was wrong; re-tagged' });
    expect(dis.body.status).toBe('dismissed');
    await evaluate(D(0), D(3));
    expect((await find(BM, 'low_call_average', D(2)))?.status).toBe('resolved');
    expect((await find(BM, 'geofence_breach', D(2)))?.status).toBe('dismissed');
    const audit = await owner.query(
      `select action from audit_log where entity_id = $1 order by at`,
      [low.id],
    );
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual([
      'exception.explain',
      'exception.update',
      'exception.resolve',
    ]);
  });

  it('filters and summary', async () => {
    const high = await list('abm', { userId: BM, severity: 'high' });
    expect(high.every((e) => e.severity === 'high')).toBe(true);
    const st = await list('abm', { userId: BM, status: 'resolved,dismissed' });
    expect(st.length).toBeGreaterThanOrEqual(2);
    const page1 = await http()
      .get('/v1/exceptions')
      .query({ userId: BM, from: D(0), to: D(3), limit: 2 })
      .set(as('abm'));
    expect(page1.body.items).toHaveLength(2);
    const page2 = await http()
      .get('/v1/exceptions')
      .query({ userId: BM, from: D(0), to: D(3), limit: 2, cursor: page1.body.nextCursor })
      .set(as('abm'));
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    expect(
      (await http().get('/v1/exceptions').query({ status: 'bogus' }).set(as('abm'))).status,
    ).toBe(422);
    const s = await http()
      .get('/v1/exceptions/summary')
      .query({ from: D(0), to: D(3), userId: BM })
      .set(as('abm'));
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    const all = await list('abm', { userId: BM });
    expect(s.body.total).toBe(all.length);
    expect(s.body.open).toBe(all.filter((e) => ['open', 'acknowledged'].includes(e.status)).length);
    expect(
      s.body.byRule.find((r: { ruleCode: string }) => r.ruleCode === 'dcr_missing'),
    ).toMatchObject({
      severity: 'high',
      total: 1,
    });
    const s2 = await http()
      .get('/v1/exceptions/summary')
      .query({ from: D(0), to: D(3), userId: BM })
      .set(as('bm2'));
    expect(s2.body.total).toBe(0);
  });

  it('rules: defaults, override (settings:write), range check, reset; thresholds drive evaluation', async () => {
    const g = await http().get('/v1/exception-rules').set(as('bm'));
    expect(g.status).toBe(200);
    expect(g.body.items).toHaveLength(8);
    expect(g.body.items.find((r: { code: string }) => r.code === 'low_call_average')).toMatchObject(
      {
        threshold: 8,
        isDefault: true,
        version: null,
      },
    );
    expect(
      (
        await http()
          .put('/v1/exception-rules/low_call_average')
          .set(as('abm'))
          .send({ threshold: 2 })
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .put('/v1/exception-rules/low_call_average')
          .set(as('director'))
          .send({ threshold: 99 })
      ).status,
    ).toBe(422);
    expect(
      (await http().put('/v1/exception-rules/dcr_late').set(as('director')).send({ threshold: 2 }))
        .status,
    ).toBe(422);
    expect((await http().put('/v1/exception-rules/nope').set(as('director')).send({})).status).toBe(
      422,
    );
    const geo = await http()
      .put('/v1/exception-rules/geofence_breach')
      .set(as('director'))
      .send({ threshold: 2, severity: 'high', action: 'Ride along next week' });
    expect(geo.status, JSON.stringify(geo.body)).toBe(200);
    expect(geo.body).toMatchObject({
      threshold: 2,
      severity: 'high',
      isDefault: false,
      version: 1,
    });
    // dcr_late: disable -> existing rows untouched, no new evaluation.
    const off = await http()
      .put('/v1/exception-rules/dcr_late')
      .set(as('director'))
      .send({ enabled: false });
    expect(off.body.enabled).toBe(false);
    // Lower call threshold to 2: D2 had 2 calls -> no longer below -> but row is manager-resolved (kept).
    await http()
      .put('/v1/exception-rules/low_call_average')
      .set(as('director'))
      .send({ threshold: 2 });
    await owner.query(
      `update exceptions set status = 'open', resolved_at = null, resolved_by = null, resolution_note = null
       where user_id = $1 and rule_code = 'low_call_average' and period_date = $2`,
      [BM, D(2)],
    );
    await evaluate(D(0), D(3));
    expect(await find(BM, 'low_call_average', D(2))).toMatchObject({
      status: 'resolved',
      autoResolved: true,
    });
    expect((await find(BM, 'dcr_late', D(3)))?.status).toBe('open');
    const conflict = await http()
      .put('/v1/exception-rules/geofence_breach')
      .set(as('director'))
      .send({ reset: true, version: 99 });
    expect(conflict.status).toBe(409);
    for (const code of ['geofence_breach', 'dcr_late', 'low_call_average']) {
      const r = await http()
        .put(`/v1/exception-rules/${code}`)
        .set(as('director'))
        .send({ reset: true });
      expect(r.body.isDefault).toBe(true);
    }
    const back = await http()
      .put('/v1/exception-rules/geofence_breach')
      .set(as('director'))
      .send({ enabled: true });
    expect(back.body).toMatchObject({ isDefault: false, threshold: 1, severity: 'medium' });
    await http()
      .put('/v1/exception-rules/geofence_breach')
      .set(as('director'))
      .send({ reset: true });
  });

  it('backfill endpoint: settings:write only, past ranges, max 92 days', async () => {
    expect(
      (
        await http()
          .post('/v1/exceptions/evaluate')
          .set(as('abm'))
          .send({ from: D(0), to: D(1) })
      ).status,
    ).toBe(403);
    const today = new Date().toISOString().slice(0, 10);
    expect(
      (
        await http()
          .post('/v1/exceptions/evaluate')
          .set(as('director'))
          .send({ from: addDay(today, 1), to: addDay(today, 2) })
      ).status,
    ).toBe(422);
    expect(
      (
        await http()
          .post('/v1/exceptions/evaluate')
          .set(as('director'))
          .send({ from: D(0), to: D(100) })
      ).status,
    ).toBe(422);
    expect(
      (
        await http()
          .post('/v1/exceptions/evaluate')
          .set(as('director'))
          .send({ from: D(3), to: D(0) })
      ).status,
    ).toBe(422);
  });

  it('month rules (TP deadline, coverage) and one batched digest per manager', async () => {
    await owner.query(
      `insert into tour_plans (id, company_id, user_id, month, status, submitted_at) values ($1, $2, $3, $4, 'submitted', now())`,
      [uuidv7(), A, BM2, `${Y}-05-01`],
    );
    const a = (await dcr(BM, `${Y}-04-27`, FIELD_WT, `${Y}-04-27T18:00:00+05:30`)).rows[0].id;
    await call(a, BM, `${Y}-04-27`);
    const runDate = `test-${Y}-${Date.now()}`;
    const jobs = app.get(JobsService);
    await owner.query(
      `insert into jobs (id, company_id, type, payload) values ($1, $2, 'exceptions.evaluate', $3)`,
      [uuidv7(), A, JSON.stringify({ from: APR_FROM, to: APR_TO, notify: true, runDate })],
    );
    expect(jobs).toBeTruthy();
    await drain();
    const tp = await list('director', { userId: BM, from: `${Y}-05-01`, to: `${Y}-05-01` });
    expect(tp.map((e) => e.ruleCode)).toEqual(['tp_not_submitted']);
    expect(await list('director', { userId: BM2, from: `${Y}-05-01`, to: `${Y}-05-01` })).toEqual(
      [],
    );
    const cov = await find(BM, 'coverage_gap', `${Y}-04-01`);
    const listed = await owner.query(
      `select count(*)::int n from kpi_user_doctor_list where user_id = $1`,
      [BM],
    );
    if (listed.rows[0].n > 0) expect(cov?.value).toBeGreaterThan(20);
    const digests = await owner.query(
      `select user_id, data from notifications where type = 'exceptions.digest' and dedupe_key = $1`,
      [`exceptions:${runDate}`],
    );
    const by = new Map(
      digests.rows.map((r: { user_id: string; data: { total: number } }) => [r.user_id, r.data]),
    );
    expect(by.get(U.area)?.total).toBeGreaterThan(1); // bm's manager: one row, many exceptions
    expect(by.get(U.regional)?.total).toBeGreaterThan(0); // bm2's manager
    expect(by.has(BM)).toBe(false);
    // Re-run with the same runDate: nothing new, no second digest.
    await owner.query(
      `insert into jobs (id, company_id, type, payload) values ($1, $2, 'exceptions.evaluate', $3)`,
      [uuidv7(), A, JSON.stringify({ from: APR_FROM, to: APR_TO, notify: true, runDate })],
    );
    await drain();
    const again = await owner.query(
      `select count(*)::int n from notifications where type = 'exceptions.digest' and dedupe_key = $1`,
      [`exceptions:${runDate}`],
    );
    expect(again.rows[0].n).toBe(digests.rows.length);
    const inbox = await http().get('/v1/notifications').query({ limit: 100 }).set(as('abm'));
    expect(
      inbox.body.items.some(
        (n: { type: string; data: { runDate?: string } }) =>
          n.type === 'exceptions.digest' && n.data?.runDate === runDate,
      ),
    ).toBe(true);
    await owner.query(`delete from notifications where dedupe_key = $1`, [`exceptions:${runDate}`]);
  });

  it('daily system job fans out one evaluation per company', async () => {
    const jobs = app.get(JobsService);
    const key = `test-${Date.now()}`;
    await jobs.enqueueSystem('exceptions.daily', {}, key);
    const sys = await owner.query(
      `select id from jobs where type = 'exceptions.daily' and dedupe_key = $1`,
      [key],
    );
    expect(sys.rows).toHaveLength(1);
    await runner.runOnce(1);
    const st = await owner.query(`select status from jobs where id = $1`, [sys.rows[0].id]);
    expect(st.rows[0].status).toBe('done');
    const q = await owner.query(
      `select id, payload from jobs where type = 'exceptions.evaluate' and company_id = $1 and dedupe_key like $2`,
      [A, `${A}:%`],
    );
    expect(q.rows.length).toBeGreaterThan(0);
    // Do not evaluate recent days here: leave them queued for nobody; delete what this test created.
    await owner.query(`delete from jobs where id = any($1::uuid[]) and status = 'queued'`, [
      q.rows.map((r: { id: string }) => r.id),
    ]);
    await owner.query(`delete from jobs where id = $1`, [sys.rows[0].id]);
  });

  it('team profile carries exception counts', async () => {
    const r = await http().get(`/v1/team/members/${BM}/profile`).set(as('abm'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.exceptions).toMatchObject({
      open: expect.any(Number),
      openHigh: expect.any(Number),
    });
    expect(r.body.exceptions.open).toBeGreaterThan(0);
  });
});
