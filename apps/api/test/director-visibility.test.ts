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
 * Director visibility (#128 server): expense-claims scope=team, approvals scope=org (+ include),
 * GET /v1/team/members/{userId}/activity and GET /v1/audit-log, for Director vs ABM vs BM vs
 * System Admin. Line: director > rbm > abm > bm; otherAbm under rbm (not over bm).
 */
describe.skipIf(!OWNER || !APP)('Director visibility (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  let company = '';
  const tok: Record<string, string> = {};
  const id: Record<string, string> = {};
  const made = { claims: [] as string[], reqs: [] as string[], signups: [] as string[] };
  let dcrId = '';
  const http = () => request(app.getHttpServer());
  const today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const get = (who: string, url: string) => http().get(url).set({ authorization: tok[who]! });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    for (const who of ['director', 'sysadmin'])
      tok[who] = await bearerFor(http as never, who, PASSWORD);
    const add = async (who: string, role: string, mgr: string, terr: string[]) => {
      const s = await insertStaff(`dir-vis-${who}-${RUN}@example.test`, role, mgr, terr);
      id[who] = s.id;
      tok[who] = s.bearer;
    };
    await add('rbm', 'regional_business_manager', U.director, [T.region]);
    await add('abm', 'area_business_manager', id.rbm!, [T.area]);
    await add('bm', 'business_manager', id.abm!, [T.hq]);
    await add('otherAbm', 'area_business_manager', id.rbm!, [T.area]);
    await add('peer', 'business_manager', id.abm!, [T.hq]);
    company = (await owner.query(`select company_id from users where id = $1`, [id.bm])).rows[0]
      .company_id;

    // bm: a draft claim (scope=team shows drafts) and a submitted one with a pending engine request.
    const claim = async (m: string, status: string) => {
      const r = await owner.query(
        `insert into expense_claims (id, company_id, user_id, month, status, total)
         values (gen_random_uuid(), $1, $2, $3::date, $4, 123.45) returning id`,
        [company, id.bm, `${m}-01`, status],
      );
      made.claims.push(r.rows[0].id);
      return r.rows[0].id as string;
    };
    await claim(month, 'draft');
    const prev = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 2, 1))
      .toISOString()
      .slice(0, 7);
    const sub = await claim(prev, 'submitted');
    const req = await owner.query(
      `insert into approval_requests (id, company_id, entity_type, entity_id, requested_by, state, payload)
       values (gen_random_uuid(), $1, 'expense', $2, $3, 'pending', $4) returning id`,
      [company, sub, id.bm, JSON.stringify({ month: prev })],
    );
    made.reqs.push(req.rows[0].id);
    await owner.query(
      `insert into approval_steps (id, company_id, request_id, step_no, approver_user_id, decision)
       values (gen_random_uuid(), $1, $2, 1, $3, 'pending')`,
      [company, req.rows[0].id, id.abm],
    );
    await owner.query(`update expense_claims set approval_request_id = $1 where id = $2`, [
      req.rows[0].id,
      sub,
    ]);

    // bm: a meeting DCR today, then marked submitted (include=dcr shows it as pending).
    const o = await get('bm', `/v1/dcrs/options?date=${today}&products=false`);
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
    await owner.query(
      `update dcrs set status = 'submitted', submitted_at = now(), submitted_by = user_id where id = $1`,
      [dcrId],
    );

    // A pending signup asking for a BM under abm.
    const su = await owner.query(
      `insert into users (id, company_id, email, name, status) values (gen_random_uuid(), $1, $2, 'Signup Person', 'pending') returning id`,
      [company, `dir-vis-signup-${RUN}@example.test`],
    );
    id.signup = su.rows[0].id;
    const sr = await owner.query(
      `insert into signup_requests (id, company_id, user_id, requested_role, requested_manager_id)
       values (gen_random_uuid(), $1, $2, 'business_manager', $3) returning id`,
      [company, id.signup, id.abm],
    );
    made.signups.push(sr.rows[0].id);

    // Audit rows (append-only; this is the throwaway test DB).
    const audit = (action: string, actor: string | null, after: unknown, entityId = RUN) =>
      owner.query(
        `insert into audit_log (company_id, actor_user_id, action, entity_type, entity_id, after)
         values ($1, $2, $3, 'dirvis_test', $4, $5)`,
        [company, actor, action, entityId, JSON.stringify(after)],
      );
    await audit(`dirvis${RUN}.one`, id.bm!, {
      name: 'x',
      nested: { accessToken: 'abc', deep: [{ otpCode: '1234', ok: 1 }] },
      Password: 'p',
    });
    await audit(`dirvis${RUN}.two`, id.abm!, { ok: true });
    await audit(`dirvis${RUN}.three`, null, { ok: false }, `other-${RUN}`);
    await audit(`dirvis${RUN}x`, id.abm!, {});
  });
  afterAll(async () => {
    if (owner) {
      await owner.query(`delete from approval_steps where request_id = any($1)`, [made.reqs]);
      await owner.query(`update expense_claims set approval_request_id = null where id = any($1)`, [
        made.claims,
      ]);
      await owner.query(`delete from approval_requests where id = any($1)`, [made.reqs]);
      await owner.query(`delete from expense_claims where id = any($1)`, [made.claims]);
      await owner.query(`delete from signup_requests where id = any($1)`, [made.signups]);
      await owner.query(`delete from dcrs where user_id = any($1)`, [Object.values(id)]);
      await owner.end();
    }
    await app?.close();
  });

  describe('GET /v1/expense-claims?scope=team', () => {
    const ids = (b: { items: { id: string }[] }) => b.items.map((x) => x.id);
    it('Director and the manager line see every status incl. drafts, with userRole', async () => {
      for (const who of ['director', 'rbm', 'abm']) {
        const r = await get(who, `/v1/expense-claims?scope=team&userId=${id.bm}&limit=50`);
        expect([who, r.status]).toEqual([who, 200]);
        expect(ids(r.body).sort()).toEqual([...made.claims].sort());
        expect(
          r.body.items.every((x: { userRole: string }) => x.userRole === 'business_manager'),
        ).toBe(true);
        expect(r.body.total).toBe(2);
      }
      // Without scope the approver still only sees the non-draft claim (unchanged behaviour).
      const plain = await get('abm', `/v1/expense-claims?userId=${id.bm}`);
      expect(ids(plain.body)).toEqual([made.claims[1]]);
    });
    it('an ABM outside the line sees none of them', async () => {
      const r = await get('otherAbm', `/v1/expense-claims?scope=team&userId=${id.bm}`);
      expect(r.status).toBe(200);
      expect(r.body.items).toEqual([]);
    });
    it('BM and System Admin (no expenses:approve) get 403', async () => {
      expect((await get('bm', '/v1/expense-claims?scope=team')).status).toBe(403);
      expect((await get('sysadmin', '/v1/expense-claims?scope=team')).status).toBe(403);
    });
  });

  describe('GET /v1/expense-claims/{id}: Director reads drafts, read-only', () => {
    const draft = () => made.claims[0]!;
    it("Director opens another user's draft by id (flags stay off)", async () => {
      const r = await get('director', `/v1/expense-claims/${draft()}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ id: draft(), status: 'draft', userId: id.bm });
      expect(r.body.canDecide).toBe(false);
      expect(r.body.canPay).toBe(false);
    });
    it('the draft stays 404 for the manager line, outside ABM, peer BM and System Admin', async () => {
      for (const who of ['abm', 'rbm', 'otherAbm', 'peer', 'sysadmin'])
        expect([who, (await get(who, `/v1/expense-claims/${draft()}`)).status]).toEqual([who, 404]);
      // The owner still reads it.
      expect((await get('bm', `/v1/expense-claims/${draft()}`)).status).toBe(200);
    });
    it('Director writes on that draft are still rejected and change nothing', async () => {
      const auth = { authorization: tok.director! };
      const tries = [
        () => http().post(`/v1/expense-claims/${draft()}/submit`).set(auth).send({}),
        () =>
          http()
            .post(`/v1/expense-claims/${draft()}/lines`)
            .set(auth)
            .send({ date: `${month}-01`, category: 'other', amount: 1 }),
        () => http().post(`/v1/expense-claims/${draft()}/allowances`).set(auth).send({}),
        () =>
          http()
            .post(`/v1/expense-claims/${draft()}/decision`)
            .set(auth)
            .send({ decision: 'approve' }),
        () => http().post(`/v1/expense-claims/${draft()}/pay`).set(auth).send({}),
        () => http().delete(`/v1/expense-claims/${draft()}`).set(auth),
      ];
      for (const t of tries) {
        const r = await t();
        expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
      }
      const row = await owner.query(
        `select status, total, deleted_at, version from expense_claims where id = $1`,
        [draft()],
      );
      expect(row.rows[0]).toMatchObject({
        status: 'draft',
        total: '123.45',
        deleted_at: null,
        version: 1,
      });
    });
  });

  describe('GET /v1/approvals?scope=org', () => {
    type A = {
      id: string;
      subjectType: string;
      subjectId: string;
      status: string;
      level: number | null;
      totalLevels: number | null;
      requestedByRole: string | null;
      currentApprover: { id: string } | null;
      trail: { level: number; status: string; current: boolean; approver: { id: string } | null }[];
    };
    it('Director and ABM see the expense request with trail and level fields', async () => {
      for (const who of ['director', 'abm']) {
        const r = await get(who, `/v1/approvals?scope=org&userId=${id.bm}`);
        expect([who, r.status]).toEqual([who, 200]);
        const a = (r.body.items as A[]).find((x) => x.id === made.reqs[0])!;
        expect(a.subjectType).toBe('expense');
        expect(a.requestedByRole).toBe('business_manager');
        expect(a.level).toBe(1);
        expect(a.totalLevels).toBeGreaterThanOrEqual(1);
        expect(a.currentApprover?.id).toBe(id.abm);
        expect(a.trail[0]).toMatchObject({ level: 1, status: 'pending', current: true });
        expect(a.trail[0]!.approver?.id).toBe(id.abm);
        // No include: no dcr/signup items.
        expect((r.body.items as A[]).some((x) => ['dcr', 'signup'].includes(x.subjectType))).toBe(
          false,
        );
      }
    });
    it('include=dcr,signup merges DCR reviews and signup requests', async () => {
      const r = await get('abm', `/v1/approvals?scope=org&include=dcr,signup&includeTotal=true`);
      expect(r.status).toBe(200);
      const items = r.body.items as A[];
      const dcr = items.find((x) => x.subjectType === 'dcr' && x.subjectId === dcrId)!;
      expect(dcr).toMatchObject({ status: 'pending', level: 1, totalLevels: null });
      expect(dcr.requestedByRole).toBe('business_manager');
      expect(dcr.trail).toHaveLength(1);
      expect(dcr.currentApprover?.id).toBe(id.abm);
      const su = items.find((x) => x.subjectType === 'signup' && x.id === made.signups[0])!;
      expect(su).toMatchObject({ status: 'pending', level: 1 });
      expect(r.body.total).toBeGreaterThanOrEqual(3);
      // subjectType filter narrows to one source.
      const only = await get('director', `/v1/approvals?scope=org&include=dcr&subjectType=dcr`);
      expect((only.body.items as A[]).every((x) => x.subjectType === 'dcr')).toBe(true);
      expect((only.body.items as A[]).map((x) => x.subjectId)).toContain(dcrId);
      // Paging walks the merged list without repeats.
      const seen = new Set<string>();
      let cursor: string | null = '';
      for (let i = 0; i < 50 && cursor !== null; i++) {
        const pg = await get(
          'abm',
          `/v1/approvals?scope=org&include=dcr,signup&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        );
        for (const x of pg.body.items as A[]) {
          expect(seen.has(x.id)).toBe(false);
          seen.add(x.id);
        }
        cursor = pg.body.nextCursor;
      }
      expect(seen.size).toBe(items.length);
    });
    it('outside the line: no items; userId outside the subtree 403', async () => {
      const r = await get('otherAbm', `/v1/approvals?scope=org&include=dcr`);
      expect(r.status).toBe(200);
      expect(
        (r.body.items as A[]).some((x) => x.id === made.reqs[0] || x.subjectId === dcrId),
      ).toBe(false);
      expect((await get('otherAbm', `/v1/approvals?scope=org&userId=${id.bm}`)).status).toBe(403);
    });
    it('BM and System Admin (no approvals:decide) get 403; include without scope 422', async () => {
      expect((await get('bm', '/v1/approvals?scope=org')).status).toBe(403);
      expect((await get('sysadmin', '/v1/approvals?scope=org')).status).toBe(403);
      expect((await get('director', '/v1/approvals?include=dcr')).status).toBe(422);
    });
  });

  describe('GET /v1/team/members/{userId}/activity', () => {
    const act = (who: string, user: string, qs = '') =>
      get(who, `/v1/team/members/${user}/activity${qs}`);
    const back = (n: number) =>
      new Date(Date.parse(`${today}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
    it('defaults to today with detail, and the day DCR', async () => {
      const r = await act('director', id.bm!);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ from: today, to: today, today });
      expect(r.body.member).toMatchObject({ id: id.bm, role: 'business_manager' });
      expect(r.body.days).toHaveLength(1);
      expect(r.body.days[0].dcr).toMatchObject({
        id: dcrId,
        status: 'submitted',
        startTime: '10:00',
        endTime: '11:00',
        durationMin: 60,
      });
      expect(r.body.detail).toEqual({ calls: [], checkIns: [] });
      expect(r.body.totals.dcr.submitted).toBe(1);
      expect(r.body.canSeeExpenses).toBe(true);
    });
    it('a range returns one row per day and no detail; 93 days ok, 94 is RANGE_TOO_LONG', async () => {
      const r = await act('abm', id.bm!, `?from=${back(6)}&to=${today}`);
      expect(r.status).toBe(200);
      expect(r.body.days.map((x: { date: string }) => x.date)).toEqual(
        [6, 5, 4, 3, 2, 1, 0].map(back),
      );
      expect(r.body.detail).toBeNull();
      expect(r.body.totals.days).toBe(7);
      expect((await act('abm', id.bm!, `?from=${back(92)}&to=${today}`)).status).toBe(200);
      const long = await act('abm', id.bm!, `?from=${back(93)}&to=${today}`);
      expect(long.status).toBe(422);
      expect(long.body.code ?? long.body.error?.code).toBe('RANGE_TOO_LONG');
    });
    it('from > to and to > today are 422', async () => {
      expect((await act('abm', id.bm!, `?from=${today}&to=${back(1)}`)).status).toBe(422);
      const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 864e5)
        .toISOString()
        .slice(0, 10);
      expect((await act('abm', id.bm!, `?from=${today}&to=${tomorrow}`)).status).toBe(422);
    });
    it('same visibility as /profile', async () => {
      for (const [who, user] of [
        ['bm', 'bm'],
        ['bm', 'abm'],
        ['abm', 'bm'],
        ['otherAbm', 'bm'],
        ['director', 'abm'],
        ['sysadmin', 'bm'],
      ] as const) {
        const a = await act(who, id[user]!);
        const p = await get(who, `/v1/team/members/${id[user]}/profile`);
        expect([who, user, a.status]).toEqual([who, user, p.status]);
      }
      expect((await act('bm', id.bm!)).status).toBe(200);
      expect((await act('bm', id.abm!)).status).toBe(403);
      expect((await act('otherAbm', id.bm!)).status).toBe(404);
      expect((await act('sysadmin', id.bm!)).status).toBe(403);
    });
  });

  describe('GET /v1/audit-log', () => {
    type E = {
      id: string;
      action: string;
      actor: { id: string; role: string | null } | null;
      after: unknown;
    };
    const log = (who: string, qs: string) => get(who, `/v1/audit-log?${qs}`);
    it('filters: action exact and prefix, actor, entity, date range', async () => {
      const pre = await log('director', `action=dirvis${RUN}.`);
      expect(pre.status).toBe(200);
      expect((pre.body.items as E[]).map((x) => x.action).sort()).toEqual(
        [`dirvis${RUN}.one`, `dirvis${RUN}.three`, `dirvis${RUN}.two`].sort(),
      );
      const exact = await log('director', `action=dirvis${RUN}.two`);
      expect((exact.body.items as E[]).map((x) => x.action)).toEqual([`dirvis${RUN}.two`]);
      expect((exact.body.items as E[])[0]!.actor).toMatchObject({
        id: id.abm,
        role: 'area_business_manager',
      });
      const actor = await log('director', `actorUserId=${id.abm}&action=dirvis${RUN}.`);
      expect((actor.body.items as E[]).map((x) => x.action)).toEqual([`dirvis${RUN}.two`]);
      const ent = await log('director', `entityType=dirvis_test&entityId=other-${RUN}`);
      expect((ent.body.items as E[]).map((x) => x.action)).toEqual([`dirvis${RUN}.three`]);
      expect((ent.body.items as E[])[0]!.actor).toBeNull();
      const inRange = await log('director', `action=dirvis${RUN}.&from=${today}&to=${today}`);
      expect(inRange.body.items).toHaveLength(3);
      const y = new Date(Date.parse(`${today}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
      const before = await log('director', `action=dirvis${RUN}.&from=${y}&to=${y}`);
      expect(before.body.items).toHaveLength(0);
      expect((await log('director', `entityId=x`)).status).toBe(422);
      expect((await log('director', `from=${today}&to=${y}`)).status).toBe(422);
      expect((await log('director', `cursor=nope`)).status).toBe(422);
    });
    it('cursor walks newest first without repeats', async () => {
      const seen: string[] = [];
      let cursor: string | null = '';
      while (cursor !== null) {
        const r = await log(
          'sysadmin',
          `action=dirvis${RUN}.&limit=1${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(r.status).toBe(200);
        seen.push(...(r.body.items as E[]).map((x) => x.id));
        cursor = r.body.nextCursor;
      }
      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(3);
      expect([...seen].sort((a, b) => Number(b) - Number(a))).toEqual(seen);
    });
    it('redacts sensitive keys at any depth', async () => {
      const r = await log('director', `action=dirvis${RUN}.one`);
      expect((r.body.items as E[])[0]!.after).toEqual({
        name: 'x',
        nested: { accessToken: '[redacted]', deep: [{ otpCode: '[redacted]', ok: 1 }] },
        Password: '[redacted]',
      });
    });
    it('403 without audit:read', async () => {
      for (const who of ['bm', 'abm', 'rbm'])
        expect([who, (await log(who, 'limit=1')).status]).toEqual([who, 403]);
    });
  });
});
