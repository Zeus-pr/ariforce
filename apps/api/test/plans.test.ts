import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { istDate, monthDates } from '@ariforce/contracts';
import { Pool } from 'pg';
import { T } from '@ariforce/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
const M = '2027-02'; // starts on a Monday, 28 days

// Integration against the throwaway SSD Postgres (scripts/test-db.sh). Skipped without a DB.
describe.skipIf(!OWNER || !APP)('tour plans + approvals (real API)', () => {
  let app: INestApplication;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let entry: Record<string, unknown>;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    for (const who of ['director', 'bm', 'abm', 'rbm']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      expect(res.status).toBe(200);
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
    const wt = await http().get('/v1/work-types?limit=50').set(as('bm'));
    const field = wt.body.items.find((w: { kind: string }) => w.kind === 'field');
    entry = { session: 'full', workTypeId: field.id, territoryIds: [T.hq] };
  });
  afterAll(async () => {
    await app?.close();
  });
  const full = () => monthDates(M).map((date) => ({ date, entries: [entry] }));

  it('standard plan read/edit and copy honouring fromStp / fromMonth', async () => {
    const empty = await http().get('/v1/tour-plans/standard').set(as('bm'));
    expect(empty.status, JSON.stringify(empty.body)).toBe(200);
    expect(empty.body.days).toEqual([]);
    const dup = await http()
      .put('/v1/tour-plans/standard')
      .set(as('bm'))
      .send({
        days: [
          { week: 1, weekday: 1, entries: [entry] },
          { week: 1, weekday: 1, entries: [entry] },
        ],
      });
    expect(dup.status).toBe(422);
    const std = await http()
      .put('/v1/tour-plans/standard')
      .set(as('bm'))
      .send({
        days: [
          { week: 1, weekday: 1, entries: [entry] },
          { week: 2, weekday: 3, entries: [entry] },
        ],
      });
    expect(std.status, JSON.stringify(std.body)).toBe(200);
    const stale = await http()
      .put('/v1/tour-plans/standard')
      .set(as('bm'))
      .send({ days: [], version: std.body.version + 3 });
    expect(stale.status).toBe(409);
    const team = await http()
      .get(`/v1/tour-plans/standard?userId=${std.body.userId}`)
      .set(as('abm'));
    expect(team.body.days).toHaveLength(2);

    const c = await http().post(`/v1/tour-plans/${M}/copy`).set(as('bm')).send({ fromStp: true });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.days.map((d: { date: string }) => d.date)).toEqual(['2027-02-01', '2027-02-10']);
    const none = await http()
      .post(`/v1/tour-plans/${M}/copy`)
      .set(as('bm'))
      .send({ fromMonth: '2020-01' });
    expect(none.status).toBe(404);
    const prev = await http()
      .post(`/v1/tour-plans/${M}/copy`)
      .set(as('bm'))
      .send({ fromStp: false });
    expect(prev.status).toBe(404); // no 2027-01 plan
  });

  it('upsert validates scope; submit needs every date (422) and creates an approval', async () => {
    const out = await http()
      .put(`/v1/tour-plans/${M}`)
      .set(as('bm'))
      .send({ days: [{ date: `${M}-03`, entries: [{ ...entry, territoryIds: [T.otherArea] }] }] });
    expect(out.status).toBe(422);
    const wrongMonth = await http()
      .put(`/v1/tour-plans/${M}`)
      .set(as('bm'))
      .send({ days: [{ date: '2027-03-01', entries: [entry] }] });
    expect(wrongMonth.status).toBe(422);
    const early = await http().post(`/v1/tour-plans/${M}/submit`).set(as('bm'));
    expect(early.status).toBe(422);
    // 2027-02 is a future month: every non-Sunday date (24) minus the 2 already planned by the copy test.
    expect(early.body.error.details.missingDates).toHaveLength(22);
    expect(early.body.error.details.weeklyOffDays).toEqual([0]);
    expect(
      (early.body.error.details.missingDates as string[]).some(
        (d) => new Date(d).getUTCDay() === 0,
      ),
    ).toBe(false);
    const saved = await http().put(`/v1/tour-plans/${M}`).set(as('bm')).send({ days: full() });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const sub = await http().post(`/v1/tour-plans/${M}/submit`).set(as('bm'));
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.status).toBe('submitted');
    expect(
      (await http().put(`/v1/tour-plans/${M}`).set(as('bm')).send({ days: full() })).status,
    ).toBe(409);
  });

  it('submit rule: current month ignores past days (today counts); weekly off from leave_settings', async () => {
    const cur = istDate().slice(0, 7);
    const today = istDate();
    const cal = await http().get(`/v1/tour-plans/${cur}/calendar`).set(as('director'));
    expect(cal.status).toBe(200);
    expect(cal.body).toMatchObject({ month: cur, todayIST: today, weeklyOffDays: [0] });
    const req = cal.body.requiredDates as string[];
    expect(req.every((d) => d >= today && new Date(d).getUTCDay() !== 0)).toBe(true);
    if (new Date(today).getUTCDay() !== 0) expect(req).toContain(today);
    // Empty plan: only today-and-later non-off dates are reported missing.
    expect(
      (await http().put(`/v1/tour-plans/${cur}`).set(as('director')).send({ days: [] })).status,
    ).toBe(200);
    const early = await http().post(`/v1/tour-plans/${cur}/submit`).set(as('director'));
    if (req.length) {
      expect(early.status).toBe(422);
      expect(early.body.error.details.missingDates).toEqual(req);
      expect(early.body.error.details.todayIST).toBe(today);
      // Plan only today onward (past days left empty) → submit succeeds.
      const days = req.map((date) => ({ date, entries: [entry] }));
      expect(
        (await http().put(`/v1/tour-plans/${cur}`).set(as('director')).send({ days })).status,
      ).toBe(200);
      const sub = await http().post(`/v1/tour-plans/${cur}/submit`).set(as('director'));
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    } else expect(early.status).toBe(200);

    // Weekly off is the company's leave_settings.weekly_off_days.
    const owner = new Pool({ connectionString: OWNER });
    try {
      // The settings row is created lazily; upsert so this does not depend on test order.
      await owner.query(
        `insert into leave_settings (id, company_id, weekly_off_days)
         select gen_random_uuid(), id, '{0,6}' from companies where slug = 'demo'
         on conflict (company_id) do update set weekly_off_days = '{0,6}'`,
      );
      const c2 = await http().get('/v1/tour-plans/2027-05/calendar').set(as('director'));
      expect(c2.body.weeklyOffDays).toEqual([0, 6]);
      expect(c2.body.requiredDates).toHaveLength(21); // May 2027: 31 - 5 Sat - 5 Sun
    } finally {
      await owner.query(
        `update leave_settings set weekly_off_days = '{0}' where company_id = (select id from companies where slug = 'demo')`,
      );
      await owner.end();
    }
  });

  it('approvals: scoped, mine=to_decide, no self-approval', async () => {
    const bmMine = await http().get('/v1/approvals?mine=requested').set(as('bm'));
    const req = bmMine.body.items.find((a: { summary: string }) => a.summary === `Tour plan ${M}`);
    expect(req).toMatchObject({ status: 'pending', subjectType: 'tour_plan' });
    expect((await http().get('/v1/approvals?mine=to_decide').set(as('bm'))).body.items).toEqual([]);
    expect(
      (
        await http()
          .post(`/v1/approvals/${req.id}/decision`)
          .set(as('bm'))
          .send({ decision: 'approve' })
      ).status,
    ).toBe(403);

    // ABM submits their own plan: they cannot decide it, RBM can.
    await http().put(`/v1/tour-plans/${M}`).set(as('abm')).send({ days: full() });
    expect((await http().post(`/v1/tour-plans/${M}/submit`).set(as('abm'))).status).toBe(200);
    const abmQueue = await http().get('/v1/approvals?mine=to_decide').set(as('abm'));
    const ids = abmQueue.body.items.map((a: { id: string }) => a.id);
    expect(ids).toContain(req.id);
    const own = (await http().get('/v1/approvals?mine=requested').set(as('abm'))).body.items[0];
    expect(ids).not.toContain(own.id);
    expect(
      (
        await http()
          .post(`/v1/approvals/${own.id}/decision`)
          .set(as('abm'))
          .send({ decision: 'approve' })
      ).status,
    ).toBe(403);
    expect(
      (await http().get('/v1/approvals?mine=to_decide').set(as('rbm'))).body.items.map(
        (a: { id: string }) => a.id,
      ),
    ).toContain(own.id);

    const noComment = await http()
      .post(`/v1/approvals/${req.id}/decision`)
      .set(as('abm'))
      .send({ decision: 'reject' });
    expect(noComment.status).toBe(422);
    const ok = await http()
      .post(`/v1/approvals/${req.id}/decision`)
      .set(as('abm'))
      .send({ decision: 'approve' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', decidedBy: expect.any(String) });
    expect(
      (
        await http()
          .post(`/v1/approvals/${req.id}/decision`)
          .set(as('abm'))
          .send({ decision: 'approve' })
      ).status,
    ).toBe(409);
    const tp = await http().get(`/v1/tour-plans/${M}`).set(as('bm'));
    expect(tp.body.status).toBe('approved');

    const rej = await http()
      .post(`/v1/approvals/${own.id}/decision`)
      .set(as('rbm'))
      .send({ decision: 'reject', comment: 'Rework week 2' });
    expect(rej.status).toBe(200);
    const abmTp = await http().get(`/v1/tour-plans/${M}`).set(as('abm'));
    expect(abmTp.body).toMatchObject({ status: 'rejected', decisionComment: 'Rework week 2' });
    expect(
      (await http().put(`/v1/tour-plans/${M}`).set(as('abm')).send({ days: full() })).body.status,
    ).toBe('draft');
  });
});
