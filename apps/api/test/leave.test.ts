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
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const TODAY = ist(new Date());
const addDay = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const NEXT = Number(TODAY.slice(0, 4)) + 1;
/** First Monday of March next year: Mon..Fri are working days, Sunday is the weekly off. */
let MON = `${NEXT}-03-01`;
while (dow(MON) !== 1) MON = addDay(MON, 1);
const D = (n: number) => addDay(MON, n);

describe.skipIf(!OWNER || !APP)('leave (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  let company = '';
  const apply = (who: string, b: Record<string, unknown>) =>
    http().post('/v1/leave/requests').set(as(who)).send(b);
  const decide = (who: string, id: string, decision = 'approve', comment?: string) =>
    http().post(`/v1/leave/requests/${id}/decision`).set(as(who)).send({ decision, comment });
  const bal = async (who: string, code: string, year = NEXT, userId?: string) => {
    const r = await http()
      .get('/v1/leave/balances')
      .query({ year, ...(userId ? { userId } : {}) })
      .set(as(who));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.items.find((i: { typeCode: string }) => i.typeCode === code);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    company = (await owner.query(`select company_id from users where id = $1`, [U.rep])).rows[0]
      .company_id;
    // Re-runs on the same DB: retire this suite's earlier leave rows.
    const users = [U.rep, U.otherRep, U.area];
    await owner.query(
      `update leave_requests set deleted_at = now() where deleted_at is null and user_id = any($1)`,
      [users],
    );
    await owner.query(
      `update leave_grants set deleted_at = now() where deleted_at is null and user_id = any($1)`,
      [users],
    );
    for (const who of ['bm', 'bm2', 'abm', 'rbm', 'accountant', 'director']) {
      const res = await http()
        .post('/v1/auth/sign-in/email')
        .send({ email: `${who}@demo.ariforce.in`, password: PASSWORD });
      tok[who] = `Bearer ${res.headers['set-auth-token']}`;
    }
    const d = await http().get('/v1/leave/settings').set(as('director'));
    expect(d.body.backdateDays, 'new-company default backdating window').toBe(14);
    const s = await http()
      .put('/v1/leave/settings')
      .set(as('director'))
      .send({ maxFutureDays: 731, approvalLevels: 2, backdateDays: 14, weeklyOffDays: [0] });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
  });
  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  it('default policies are data', async () => {
    const r = await http().get('/v1/leave/types').set(as('bm'));
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.items.map((t: { code: string }) => [t.code, t]));
    expect(by.CL).toMatchObject({ annualQuota: 12 });
    expect(by.SL).toMatchObject({ annualQuota: 12 });
    expect(by.EL).toMatchObject({ annualQuota: 15, carryForward: true, carryForwardCap: 30 });
    expect(by.LOP).toMatchObject({ annualQuota: null, paid: false });
    expect(by.COMP).toMatchObject({ grantOnly: true });
    expect((await http().put('/v1/leave/types/CL').set(as('bm')).send({})).status).toBe(403);
    expect((await http().get('/v1/leave/requests').set(as('accountant'))).status).toBe(403);
  });

  it('apply, 2-level chain, no self-approval, balances, overlap, cancel', async () => {
    expect((await bal('bm', 'CL')).available).toBe(12);
    let r = await apply('bm', { typeCode: 'CL', fromDate: D(0), toDate: D(6), reason: 'trip' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'pending', days: 6, year: NEXT }); // Sunday excluded
    const id = r.body.id as string;
    expect(await bal('bm', 'CL')).toMatchObject({ pending: 6, available: 6 });

    r = await apply('bm', { typeCode: 'SL', fromDate: D(2), toDate: D(2) });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('LEAVE_OVERLAP');
    r = await apply('bm', { typeCode: 'CL', fromDate: D(7), toDate: D(14) });
    expect(r.body.error.code).toBe('LEAVE_INSUFFICIENT_BALANCE');

    expect((await decide('bm', id)).status).toBe(403);
    r = await decide('abm', id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('pending');
    expect((await decide('abm', id)).status).toBe(403);
    r = await decide('rbm', id);
    expect(r.body.status).toBe('approved');
    expect(await bal('bm', 'CL')).toMatchObject({ used: 6, pending: 0, available: 6 });
    expect((await bal('abm', 'CL', NEXT, U.rep)).used).toBe(6);
    expect(
      (await http().get('/v1/leave/balances').query({ userId: U.rep }).set(as('bm2'))).status,
    ).toBe(404);

    const cal = await http()
      .get('/v1/leave/calendar')
      .query({ from: D(0), to: D(13) })
      .set(as('abm'));
    expect(cal.status).toBe(200);
    const e = cal.body.items.find((x: { requestId: string }) => x.requestId === id);
    expect(e.dates).toHaveLength(6);
    expect(e.dates).not.toContain(D(6));

    r = await http().post(`/v1/leave/requests/${id}/cancel`).set(as('bm2')).send({});
    expect(r.status).toBe(404);
    r = await http().post(`/v1/leave/requests/${id}/cancel`).set(as('bm')).send({ reason: 'x' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('cancelled');
    expect((await bal('bm', 'CL')).available).toBe(12);
    r = await http().post(`/v1/leave/requests/${id}/cancel`).set(as('bm')).send({});
    expect(r.body.error.code).toBe('LEAVE_NOT_CANCELLABLE');
  });

  it('half days, reject, validation codes', async () => {
    const r = await apply('bm', { typeCode: 'SL', fromDate: D(9), toDate: D(9), half: 'am' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.days).toBe(0.5);
    const pm = await apply('bm', { typeCode: 'SL', fromDate: D(9), toDate: D(9), half: 'pm' });
    expect(pm.status).toBe(201);
    expect(
      (await apply('bm', { typeCode: 'SL', fromDate: D(9), toDate: D(9), half: 'am' })).status,
    ).toBe(409);
    expect((await decide('abm', r.body.id, 'reject')).status).toBe(422);
    const rej = await decide('abm', r.body.id, 'reject', 'busy');
    expect(rej.body.status).toBe('rejected');
    expect((await bal('bm', 'SL')).pending).toBe(0.5);

    const code = async (b: Record<string, unknown>) => (await apply('bm', b)).body.error?.code;
    expect(await code({ typeCode: 'XX', fromDate: D(15), toDate: D(15) })).toBe(
      'LEAVE_TYPE_UNKNOWN',
    );
    expect(
      await code({ typeCode: 'CL', fromDate: `${NEXT}-12-31`, toDate: `${NEXT + 1}-01-01` }),
    ).toBe('LEAVE_SPANS_YEARS');
    expect(
      await code({ typeCode: 'CL', fromDate: addDay(TODAY, -15), toDate: addDay(TODAY, -15) }),
    ).toBe('LEAVE_BACKDATE_WINDOW');
    expect(await code({ typeCode: 'CL', fromDate: D(6), toDate: D(6) })).toBe(
      'LEAVE_NO_WORKING_DAYS',
    );
    expect(await code({ typeCode: 'COMP', fromDate: D(15), toDate: D(15) })).toBe(
      'LEAVE_INSUFFICIENT_BALANCE',
    );
    expect((await apply('bm', { typeCode: 'CL', fromDate: D(2), toDate: D(1) })).status).toBe(422);
  });

  it('comp-off grants and LOP unlimited', async () => {
    let r = await http()
      .post('/v1/leave/grants')
      .set(as('bm'))
      .send({ userId: U.rep, typeCode: 'COMP', year: NEXT, days: 1, reason: 'x' });
    expect(r.status).toBe(403);
    r = await http()
      .post('/v1/leave/grants')
      .set(as('abm'))
      .send({ userId: U.area, typeCode: 'COMP', year: NEXT, days: 1, reason: 'x' });
    expect(r.body.error?.code).toBe('LEAVE_SELF_GRANT');
    r = await http()
      .post('/v1/leave/grants')
      .set(as('abm'))
      .send({
        userId: U.rep,
        typeCode: 'COMP',
        year: NEXT,
        days: 1,
        workedDate: D(6),
        reason: 'Sunday camp',
      });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await bal('bm', 'COMP')).toMatchObject({ granted: 1, available: 1 });
    r = await apply('bm', { typeCode: 'COMP', fromDate: D(16), toDate: D(16) });
    expect(r.status).toBe(201);
    const lop = await bal('bm', 'LOP');
    expect(lop).toMatchObject({ unlimited: true, available: null });
    r = await apply('bm', { typeCode: 'LOP', fromDate: D(21), toDate: D(25) });
    expect(r.status).toBe(201);
  });

  it('carry-forward is capped and idempotent', async () => {
    const r = await http()
      .post('/v1/leave/carry-forward')
      .set(as('director'))
      .send({ fromYear: NEXT });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const again = await http()
      .post('/v1/leave/carry-forward')
      .set(as('director'))
      .send({ fromYear: NEXT });
    expect(again.status).toBe(200);
    const el = await bal('bm', 'EL', NEXT + 1);
    expect(el.carriedForward).toBe(15);
    expect(el.available).toBe(30);
    expect(
      (await http().post('/v1/leave/carry-forward').set(as('abm')).send({ fromYear: NEXT })).status,
    ).toBe(403);
  });

  it.skipIf(dow(TODAY) === 0)(
    'approved leave: attendance shows leave; DCR and tour plan entries blocked',
    async () => {
      let r = await apply('bm2', { typeCode: 'CL', fromDate: TODAY, toDate: TODAY });
      if (r.status === 409) return; // another suite already filed a DCR for bm2 today
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const lid = r.body.id as string;
      expect((await decide('rbm', lid)).status).toBe(200);
      r = await decide('director', lid);
      expect(r.body.status).toBe('approved');
      const att = await http()
        .get('/v1/attendance')
        .query({ from: TODAY, to: TODAY, userId: U.otherRep })
        .set(as('director'));
      expect(att.status).toBe(200);
      const day = att.body.items.find((d: { userId: string }) => d.userId === U.otherRep);
      if (!day.punchIn) expect(day.status).toBe('leave');
      expect(day.leave).toMatchObject({ typeCode: 'CL', half: null });

      const field = (
        await owner.query(
          `select id from work_types where company_id = $1 and kind = 'field' and active and deleted_at is null limit 1`,
          [company],
        )
      ).rows[0].id;
      const dcr = await http()
        .put('/v1/dcrs')
        .set(as('bm2'))
        .send({ date: TODAY, workTypeId: field, territoryIds: [], calls: [] });
      expect(dcr.status).toBe(422);
      expect(dcr.body.error.code).toBe('LEAVE_DAY_BLOCKED');
    },
  );
});
