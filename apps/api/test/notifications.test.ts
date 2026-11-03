import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { U } from '@ariforce/db';
import { bearerFor } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { backoffSeconds, JobsRunner, runnerEnabled } from '../src/jobs/jobs.runner';
import { JobsService } from '../src/jobs/jobs.service';
import { render } from '../src/notifications/templates';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const addDay = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
// A Monday in next year's autumn, offset per run so re-runs on one DB do not overlap.
const NEXT = new Date().getUTCFullYear() + 1;
let MON = addDay(`${NEXT}-09-01`, 7 * (Date.now() % 8));
while (dow(MON) !== 1) MON = addDay(MON, 1);
const D = (n: number) => addDay(MON, n);
const MONTH = `${1981 + (Date.now() % 15)}-05`;

describe('notification units', () => {
  it('backoff doubles from 30 s and caps at 1 h', () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([30, 60, 120, 240]);
    expect(backoffSeconds(20)).toBe(3600);
  });
  it('runner default: on in production only, env overrides', () => {
    const env = { ...process.env };
    process.env.NODE_ENV = 'production';
    delete process.env.JOBS_RUNNER_ENABLED;
    expect(runnerEnabled()).toBe(true);
    process.env.JOBS_RUNNER_ENABLED = 'false';
    expect(runnerEnabled()).toBe(false);
    process.env.NODE_ENV = 'test';
    delete process.env.JOBS_RUNNER_ENABLED;
    expect(runnerEnabled()).toBe(false);
    process.env = env;
  });
  it('renders English text', () => {
    expect(
      render('leave.submitted', { actorName: 'A', typeCode: 'CL', fromDate: 'x', toDate: 'y' }),
    ).toEqual({ title: 'Leave request to review', body: 'A applied for CL leave x to y.' });
    expect(render('expense.paid', { month: '2026-01', total: 10, paymentRef: 'R' }).body).toBe(
      'Your 2026-01 expense claim (INR 10) was marked paid (ref R).',
    );
  });
});

describe.skipIf(!OWNER || !APP)('notifications (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  let runner: JobsRunner;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  const drain = async () => {
    while ((await runner.runOnce(50)) > 0);
  };
  const inbox = async (who: string, entityId?: string) => {
    const r = await http().get('/v1/notifications').query({ limit: 100 }).set(as(who));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return (r.body.items as { type: string; entityId: string; body: string }[]).filter(
      (n) => !entityId || n.entityId === entityId,
    );
  };
  const types = async (who: string, id: string) => (await inbox(who, id)).map((n) => n.type);
  const approvedDcr = async (userId: string, date: string) => {
    await owner.query(
      `insert into dcrs (id, company_id, user_id, date, work_type_id, status)
       select gen_random_uuid(), u.company_id, u.id, $2, wt.id, 'approved'
       from users u join work_types wt on wt.company_id = u.company_id
       where u.id = $1 and wt.counts_as_field_day limit 1`,
      [userId, date],
    );
  };

  beforeAll(async () => {
    process.env.EXPENSE_APPROVAL_LEVELS = '2';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    runner = app.get(JobsRunner);
    owner = new Pool({ connectionString: OWNER });
    for (const who of ['bm', 'bm2', 'abm', 'rbm', 'accountant', 'sysadmin', 'director']) {
      tok[who] = await bearerFor(http, who, PASSWORD);
    }
    const types = await http().get('/v1/leave/types').set(as('director'));
    expect(types.status, JSON.stringify(types.body)).toBe(200);
    const s = await http()
      .put('/v1/leave/settings')
      .set(as('director'))
      .send({ maxFutureDays: 731, approvalLevels: 2, backdateDays: 14, weeklyOffDays: [0] });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
  });
  afterAll(async () => {
    delete process.env.EXPENSE_APPROVAL_LEVELS;
    await owner?.end();
    await app?.close();
  });

  const apply = (from: string, to = from) =>
    http()
      .post('/v1/leave/requests')
      .set(as('bm'))
      .send({ typeCode: 'LOP', fromDate: from, toDate: to, reason: 'notify test' });
  const decide = (who: string, id: string, decision = 'approve') =>
    http()
      .post(`/v1/leave/requests/${id}/decision`)
      .set(as(who))
      .send({ decision, comment: decision === 'reject' ? 'no' : undefined });

  it('leave: submitted -> approver per step, approved -> requester, nobody notified of own action', async () => {
    const r = await apply(D(0), D(1));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id as string;
    // Enqueued in the same transaction, delivered only by the runner.
    const q = await owner.query(
      `select count(*)::int n from jobs where type = 'notify' and payload->>'entityId' = $1`,
      [id],
    );
    expect(q.rows[0].n).toBe(1);
    expect(await types('abm', id)).toEqual([]);
    await drain();
    expect(await types('abm', id)).toEqual(['leave.submitted']);
    expect((await inbox('abm', id))[0]!.body).toMatch(/applied for LOP leave/);
    expect(await types('bm', id)).toEqual([]);
    expect((await decide('abm', id)).status).toBe(200);
    await drain();
    expect(await types('rbm', id)).toEqual(['leave.submitted']);
    expect(await types('bm', id)).toEqual([]);
    expect((await decide('rbm', id)).body.status).toBe('approved');
    await drain();
    await drain(); // replay is a no-op
    expect(await types('bm', id)).toEqual(['leave.approved']);
    expect(await types('rbm', id)).toEqual(['leave.submitted']);
    // Manager cancels approved leave -> requester.
    const c = await http().post(`/v1/leave/requests/${id}/cancel`).set(as('abm')).send({});
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    await drain();
    expect((await types('bm', id)).sort()).toEqual(['leave.approved', 'leave.cancelled']);
  });

  it('leave: rejected -> requester; owner cancel while pending -> current approver', async () => {
    let r = await apply(D(2));
    const id = r.body.id as string;
    expect((await decide('abm', id, 'reject')).body.status).toBe('rejected');
    await drain();
    expect(await types('bm', id)).toEqual(['leave.rejected']);
    expect((await inbox('bm', id))[0]!.body).toMatch(/Reason: no/);

    r = await apply(D(3));
    const id2 = r.body.id as string;
    expect(
      (await http().post(`/v1/leave/requests/${id2}/cancel`).set(as('bm')).send({})).status,
    ).toBe(200);
    await drain();
    expect((await types('abm', id2)).sort()).toEqual(['leave.cancelled', 'leave.submitted']);
    expect(await types('bm', id2)).toEqual([]);
  });

  it('a failing enqueue never breaks the business action', async () => {
    const jobs = app.get(JobsService);
    const spy = vi.spyOn(jobs, 'enqueue').mockImplementationOnce(async (tx) => {
      await tx.execute(sql`select 1 / 0`);
    });
    const r = await apply(D(4));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    const row = await owner.query(`select status from leave_requests where id = $1`, [r.body.id]);
    expect(row.rows[0].status).toBe('pending');
    await http().post(`/v1/leave/requests/${r.body.id}/cancel`).set(as('bm')).send({});
  });

  it('expense: submitted -> approvers, approved / paid -> claimant', async () => {
    await approvedDcr(U.rep, `${MONTH}-03`);
    let r = await http().post('/v1/expense-claims').set(as('bm')).send({ month: MONTH });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id as string;
    r = await http()
      .post(`/v1/expense-claims/${id}/lines`)
      .set(as('bm'))
      .send({ date: `${MONTH}-03`, category: 'travel', amount: 500, notes: 'bus' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await http().post(`/v1/expense-claims/${id}/submit`).set(as('bm'))).status).toBe(200);
    await drain();
    expect(await types('abm', id)).toEqual(['expense.submitted']);
    const dec = (who: string, decision: string) =>
      http()
        .post(`/v1/expense-claims/${id}/decision`)
        .set(as(who))
        .send({ decision, comment: 'c' });
    expect((await dec('abm', 'approve')).status).toBe(200);
    await drain();
    expect(await types('rbm', id)).toEqual(['expense.submitted']);
    expect((await dec('rbm', 'approve')).body.status).toBe('approved');
    r = await http()
      .post(`/v1/expense-claims/${id}/pay`)
      .set(as('director'))
      .send({ paymentRef: 'NEFT-9' });
    expect(r.body.status).toBe('paid');
    await drain();
    expect((await types('bm', id)).sort()).toEqual(['expense.approved', 'expense.paid']);
    expect((await inbox('bm', id)).find((n) => n.type === 'expense.paid')!.body).toBe(
      `Your ${MONTH} expense claim (INR 500) was marked paid (ref NEFT-9).`,
    );
  });

  it('expense: rejected -> claimant', async () => {
    const m = `${Number(MONTH.slice(0, 4))}-06`;
    let r = await http().post('/v1/expense-claims').set(as('bm')).send({ month: m });
    const id = r.body.id as string;
    await http()
      .post(`/v1/expense-claims/${id}/lines`)
      .set(as('bm'))
      .send({ date: `${m}-03`, category: 'travel', amount: 100, notes: null });
    await http().post(`/v1/expense-claims/${id}/submit`).set(as('bm'));
    r = await http()
      .post(`/v1/expense-claims/${id}/decision`)
      .set(as('abm'))
      .send({ decision: 'reject', comment: 'missing' });
    expect(r.body.status, JSON.stringify(r.body)).toBe('rejected');
    await drain();
    expect(await types('bm', id)).toEqual(['expense.rejected']);
  });

  it('read, read-all, unread-count, pagination, own only', async () => {
    // Seed 7 notifications for bm2 directly (owner) so counts are exact.
    await owner.query(`delete from notifications where user_id = $1`, [U.otherRep]);
    const company = (await owner.query(`select company_id from users where id = $1`, [U.otherRep]))
      .rows[0].company_id;
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const id = uuidv7();
      ids.push(id);
      await owner.query(
        `insert into notifications (id, company_id, user_id, type, title, body, dedupe_key) values ($1,$2,$3,'leave.approved','t','b',$4)`,
        [id, company, U.otherRep, `seed:${id}`],
      );
    }
    const count = async () =>
      (await http().get('/v1/notifications/unread-count').set(as('bm2'))).body.count;
    expect(await count()).toBe(7);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const r = await http()
        .get('/v1/notifications')
        .query({ limit: 3, ...(cursor ? { cursor } : {}) })
        .set(as('bm2'));
      expect(r.status).toBe(200);
      expect(r.body.items.length).toBeLessThanOrEqual(3);
      seen.push(...r.body.items.map((n: { id: string }) => n.id));
      cursor = r.body.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
    expect((await http().get('/v1/notifications').query({ limit: 0 }).set(as('bm2'))).status).toBe(
      422,
    );
    expect(
      (await http().get('/v1/notifications').query({ limit: 101 }).set(as('bm2'))).status,
    ).toBe(422);

    let r = await http().post(`/v1/notifications/${ids[0]}/read`).set(as('bm2'));
    expect(r.status).toBe(200);
    const first = r.body.readAt as string;
    expect(first).toBeTruthy();
    r = await http().post(`/v1/notifications/${ids[0]}/read`).set(as('bm2'));
    expect(r.body.readAt).toBe(first); // idempotent
    expect(await count()).toBe(6);
    r = await http()
      .get('/v1/notifications')
      .query({ unreadOnly: 'true', limit: 100 })
      .set(as('bm2'));
    expect(r.body.items.map((n: { id: string }) => n.id)).not.toContain(ids[0]);
    expect(r.body.items).toHaveLength(6);

    // Someone else's notification is a 404, and their reads do not touch mine.
    expect((await http().post(`/v1/notifications/${ids[1]}/read`).set(as('bm'))).status).toBe(404);
    expect((await http().post(`/v1/notifications/not-a-uuid/read`).set(as('bm'))).status).toBe(404);
    expect((await inbox('bm')).map((n) => n.entityId)).not.toContain(ids[1]);
    await http().post('/v1/notifications/read-all').set(as('bm'));
    expect(await count()).toBe(6);

    r = await http().post('/v1/notifications/read-all').set(as('bm2'));
    expect(r.body).toEqual({ updated: 6 });
    expect(await count()).toBe(0);
    expect((await http().get('/v1/notifications/unread-count')).status).toBe(401);
  });

  it('job stats: system admin only; dead jobs after max attempts', async () => {
    runner.register('test.fail', async () => {
      throw new Error('boom');
    });
    const company = (await owner.query(`select company_id from users where id = $1`, [U.rep]))
      .rows[0].company_id;
    const id = uuidv7();
    await owner.query(
      `insert into jobs (id, company_id, type, max_attempts) values ($1, $2, 'test.fail', 1)`,
      [id, company],
    );
    await drain();
    const j = (
      await owner.query(`select status, attempts, last_error from jobs where id = $1`, [id])
    ).rows[0];
    expect(j).toMatchObject({ status: 'dead', attempts: 1, last_error: 'Error: boom' });
    expect((await http().get('/v1/jobs/stats').set(as('bm'))).status).toBe(403);
    const r = await http().get('/v1/jobs/stats').set(as('sysadmin'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.dead).toBeGreaterThanOrEqual(1);
    expect(Object.keys(r.body).sort()).toEqual(['dead', 'done', 'queued', 'running']);
    await owner.query(`delete from jobs where id = $1`, [id]);
  });
});
