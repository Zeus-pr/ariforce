import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { U } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const M = '2028-03'; // this suite's own month
const [A, B, C, D] = ['03', '06', '07', '08'].map((d) => `${M}-${d}`) as [
  string,
  string,
  string,
  string,
];

// #86: tour-plan days are submitted and decided separately. Skipped without a DB.
describe.skipIf(!OWNER || !APP)('tour plan submissions (#86, real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let entry: Record<string, unknown>;
  const day = (date: string, notes = 'Plan') => ({ date, entries: [{ ...entry, notes }] });
  const queue = async () =>
    (
      await http()
        .get('/v1/approvals?mine=to_decide&subjectType=tour_plan&limit=100')
        .set(as('rbm'))
    ).body.items as { id: string; subjectId: string; status: string }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    for (const who of ['bm2', 'abm', 'rbm']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      expect(res.status).toBe(200);
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
    const sel = `select id from tour_plans where user_id = $1 and month = $2`;
    const args = [U.otherRep, `${M}-01`];
    await owner.query(`delete from tour_plan_submissions where tour_plan_id in (${sel})`, args);
    await owner.query(`delete from tour_plan_visits where tour_plan_id in (${sel})`, args);
    await owner.query(`delete from tour_plans where user_id = $1 and month = $2`, args);
    const me = await http().get('/v1/me').set(as('bm2'));
    const wt = await http().get('/v1/work-types?limit=50').set(as('bm2'));
    const field = wt.body.items.find(
      (w: { kind: string; code: string }) => w.kind === 'field' && w.code.startsWith('FIELD_'),
    );
    entry = { session: 'full', workTypeId: field.id, territoryIds: [me.body.territoryIds[0]] };
  });
  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  it('submits days separately, decides each, locks, resubmits, EMPTY_PLAN, approver scope', async () => {
    let r = await http()
      .put(`/v1/tour-plans/${M}`)
      .set(as('bm2'))
      .send({ days: [day(A), day(B), day(C)] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const planId = r.body.id as string;
    expect(r.body).toMatchObject({ status: 'draft', submissions: [] });

    // Day A, then day B, as two submissions; both requests stay pending.
    r = await http()
      .post(`/v1/tour-plans/${M}/submit`)
      .set(as('bm2'))
      .send({ dates: [A] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s1 = r.body.submissions[0];
    expect(s1).toMatchObject({ dates: [A], status: 'submitted', approvalId: expect.any(String) });
    const st = (b: { days: { date: string; status: string }[] }) =>
      Object.fromEntries(b.days.map((d) => [d.date, d.status]));
    expect(st(r.body)).toEqual({ [A]: 'submitted', [B]: 'draft', [C]: 'draft' });
    expect(r.body.status).toBe('submitted');
    r = await http()
      .post(`/v1/tour-plans/${M}/submit`)
      .set(as('bm2'))
      .send({ dates: [B], submitterNote: 'Day B only' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s2 = r.body.submissions[1];
    expect(s2).toMatchObject({ dates: [B], status: 'submitted', submitterNote: 'Day B only' });
    expect(r.body.days.find((d: { date: string }) => d.date === B).submissionId).toBe(s2.id);
    const q = await queue();
    const a1 = q.find((x) => x.subjectId === s1.id)!;
    const a2 = q.find((x) => x.subjectId === s2.id)!;
    expect(a1?.status).toBe('pending');
    expect(a2?.status).toBe('pending');
    expect(a1.id).toBe(s1.approvalId);

    // Approver scope: the detail shows only the submission's days; GET by id for the line only.
    const d1 = await http().get(`/v1/approvals/${a1.id}`).set(as('rbm'));
    expect(d1.status, JSON.stringify(d1.body)).toBe(200);
    expect(d1.body.subject.submission).toMatchObject({ id: s1.id, dates: [A] });
    expect(d1.body.subject.plan.id).toBe(planId);
    expect(d1.body.subject.days.map((x: { date: string }) => x.date)).toEqual([A]);
    expect((await http().get(`/v1/tour-plans/${planId}`).set(as('rbm'))).status).toBe(200);
    expect((await http().get(`/v1/tour-plans/${planId}`).set(as('abm'))).status).toBe(404);
    expect((await http().get(`/v1/approvals/${a1.id}`).set(as('abm'))).status).toBe(404);

    // Approve A, reject B (reason required).
    r = await http()
      .post(`/v1/approvals/${a1.id}/decision`)
      .set(as('rbm'))
      .send({ decision: 'approve' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await http()
      .post(`/v1/approvals/${a2.id}/decision`)
      .set(as('rbm'))
      .send({ decision: 'reject' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('REJECTION_REASON_REQUIRED');
    r = await http()
      .post(`/v1/approvals/${a2.id}/decision`)
      .set(as('rbm'))
      .send({ decision: 'reject', comment: 'Add doctors on B' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    let plan = await http().get(`/v1/tour-plans/${M}`).set(as('bm2'));
    expect(st(plan.body)).toEqual({ [A]: 'approved', [B]: 'rejected', [C]: 'draft' });
    expect(plan.body.status).toBe('rejected');
    expect(plan.body.submissions[0]).toMatchObject({ status: 'approved', rejectionReason: null });
    expect(plan.body.submissions[1]).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Add doctors on B',
      rejectedBy: { id: U.regional, name: expect.any(String) },
      rejectedAt: expect.any(String),
    });
    const cal = await http().get(`/v1/tour-plans/${M}/calendar`).set(as('bm2'));
    expect(cal.body.days).toEqual(
      expect.arrayContaining([
        { date: A, status: 'approved', submissionId: s1.id },
        { date: B, status: 'rejected', submissionId: s2.id },
        { date: C, status: 'draft', submissionId: null },
      ]),
    );

    // Locked: the approved day cannot change; the rejected day can; new days can be added.
    r = await http()
      .put(`/v1/tour-plans/${M}`)
      .set(as('bm2'))
      .send({ days: [day(A, 'Changed'), day(B), day(C)] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'DAY_LOCKED', details: { dates: [A] } });
    r = await http()
      .put(`/v1/tour-plans/${M}`)
      .set(as('bm2'))
      .send({ days: [day(B, 'With doctors'), day(C), day(D)] });
    expect(r.status).toBe(409); // dropping A is a change too
    r = await http()
      .put(`/v1/tour-plans/${M}`)
      .set(as('bm2'))
      .send({ days: [day(A), day(B, 'With doctors'), day(C), day(D)] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(st(r.body)).toEqual({ [A]: 'approved', [B]: 'rejected', [C]: 'draft', [D]: 'draft' });

    // Resubmit: an approved day is locked; the default set is every draft/rejected planned day.
    r = await http()
      .post(`/v1/tour-plans/${M}/submit`)
      .set(as('bm2'))
      .send({ dates: [A] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DAY_LOCKED');
    r = await http().post(`/v1/tour-plans/${M}/submit`).set(as('bm2'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s3 = r.body.submissions[2];
    expect(s3.dates).toEqual([B, C, D]);
    expect(st(r.body)).toEqual({
      [A]: 'approved',
      [B]: 'submitted',
      [C]: 'submitted',
      [D]: 'submitted',
    });
    expect(r.body).toMatchObject({ status: 'submitted', rejectionReason: null });
    expect((await queue()).find((x) => x.subjectId === s3.id)?.status).toBe('pending');

    // Nothing left to submit.
    r = await http().post(`/v1/tour-plans/${M}/submit`).set(as('bm2'));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('EMPTY_PLAN');

    // Approving the rest makes the month approved.
    r = await http()
      .post(`/v1/approvals/${s3.approvalId}/decision`)
      .set(as('rbm'))
      .send({ decision: 'approve' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    plan = await http().get(`/v1/tour-plans/${M}`).set(as('bm2'));
    expect(plan.body.status).toBe('approved');
  });
});
