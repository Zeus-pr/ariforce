import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { T, U } from '@ariforce/db';
import { insertStaff } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const RUN = Date.now().toString(36);

type Line = { id: string; origin?: string; dcrId: string | null; amount: number; category: string };

/** DCR expenses: draft persistence, idempotent link into the month claim on submit (origin dcr). */
describe.skipIf(!OWNER || !APP)('DCR expenses (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const u: Record<string, { id: string; bearer: string }> = {};
  let meetingWt = '';
  const http = () => request(app.getHttpServer());
  const as = (who = 'bm') => ({ authorization: u[who]!.bearer });
  const today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
  const details = {
    kind: 'meeting',
    title: 'Cycle Meeting',
    mode: 'online',
    startTime: '10:00',
    endTime: '11:00',
  };
  const draft = (b: Record<string, unknown> = {}, who = 'bm') =>
    http()
      .put('/v1/dcrs/draft')
      .set(as(who))
      .send({ date: today, workTypeId: meetingWt, details, ...b });
  const submit = (id: string, version: number, b: Record<string, unknown> = {}, who = 'bm') =>
    http()
      .post(`/v1/dcrs/${id}/submit`)
      .set({ ...as(who), 'idempotency-key': randomUUID() })
      .send({ version, ...b });
  const reopen = (id: string) =>
    owner.query(
      `update dcrs set status='draft', submit_idempotency_key=null, submitted_at=null, submitted_by=null where id=$1`,
      [id],
    );
  const version = async (id: string, who = 'bm') =>
    (await http().get(`/v1/dcrs/${id}`).set(as(who))).body.version as number;
  const claimLines = async (claimId: string, who = 'bm') => {
    const r = await http().get(`/v1/expense-claims/${claimId}`).set(as(who));
    return { status: r.status, lines: (r.body.lines ?? []) as Line[] };
  };
  const liveDcrLines = async (dcrId: string) =>
    (
      await owner.query(
        `select company_id, dcr_item_index, amount from expense_lines
          where dcr_id=$1 and origin='dcr' and deleted_at is null order by dcr_item_index`,
        [dcrId],
      )
    ).rows as { company_id: string; dcr_item_index: number; amount: string }[];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    const add = async (who: string, role: string, mgr: string, terr: string[]) =>
      (u[who] = await insertStaff(`dcr-exp-${who}-${RUN}@example.test`, role, mgr, terr));
    await add('rbm', 'regional_business_manager', U.director, [T.region]);
    await add('abm', 'area_business_manager', u.rbm!.id, [T.area]);
    await add('bm', 'business_manager', u.abm!.id, [T.hq]);
    await add('peer', 'business_manager', u.abm!.id, [T.hq]);
    await add('other', 'business_manager', U.regional, [T.hq]);
    const o = await http().get(`/v1/dcrs/options?date=${today}&products=false`).set(as());
    meetingWt = (o.body.workTypes as { id: string; detailsKind: string | null }[]).find(
      (w) => w.detailsKind === 'meeting',
    )!.id;
  });
  afterAll(async () => {
    const ids = Object.values(u).map((x) => x.id);
    if (ids.length) {
      await owner.query(
        `delete from expense_lines where claim_id in (select id from expense_claims where user_id = any($1))`,
        [ids],
      );
      await owner.query(`delete from expense_claims where user_id = any($1)`, [ids]);
      await owner.query(`delete from dcrs where user_id = any($1)`, [ids]);
    }
    await owner?.end();
    await app?.close();
  });

  it('draft persists expenses; omitted keeps them; invalid category is rejected', async () => {
    const r = await draft({
      expenses: [{ category: 'travel', amount: 120.5, note: 'Auto', id: 'x', receiptRef: 'r' }],
    });
    expect(r.status).toBe(200);
    expect(r.body.expenses).toEqual([{ category: 'travel', amount: 120.5, note: 'Auto' }]);
    expect([r.body.expenseClaimId, r.body.expenseTotal, r.body.expenseCount]).toEqual([null, 0, 0]);
    const kept = await draft({ id: r.body.id, version: r.body.version });
    expect(kept.body.expenses).toHaveLength(1);
    for (const category of ['allowance', 'mileage']) {
      const bad = await draft({
        expenses: [
          { category: 'food', amount: 1 },
          { category, amount: 5 },
        ],
      });
      expect([bad.status, bad.body.error.code, bad.body.error.details.index]).toEqual([
        422,
        'DCR_EXPENSE_CATEGORY_INVALID',
        1,
      ]);
    }
    const s = await submit(kept.body.id, kept.body.version, {
      expenses: [{ category: 'mileage', amount: 5 }],
    });
    expect(s.body.error.code).toBe('DCR_EXPENSE_CATEGORY_INVALID');
  });

  it('submit links lines (origin dcr), idempotent resubmit, some->none, read fields', async () => {
    const d = await draft({ expenses: [{ category: 'travel', amount: 100 }] });
    const s = await submit(d.body.id, d.body.version, {
      expenses: [
        { category: 'travel', amount: 100 },
        { category: 'food', amount: 50.25, note: 'Lunch' },
      ],
    });
    expect(s.status).toBe(200);
    expect(s.body.dcrExpenses).toMatchObject({ status: 'linked', lines: 2, total: 150.25 });
    expect(s.body.expenseClaimId).toBe(s.body.dcrExpenses.claimId);
    expect([s.body.expenseTotal, s.body.expenseCount]).toEqual([150.25, 2]);
    expect(s.body.expenses).toHaveLength(2);
    const claimId = s.body.expenseClaimId as string;
    const mine = await claimLines(claimId);
    const dl = mine.lines.filter((l) => l.dcrId === d.body.id);
    expect(dl.map((l) => [l.origin, l.category, l.amount])).toEqual(
      expect.arrayContaining([
        ['dcr', 'travel', 100],
        ['dcr', 'food', 50.25],
      ]),
    );
    // Approver (ABM, first level of the chain) sees the same lines with their origin once the
    // claim is in review (approvers do not read drafts).
    await owner.query(`update expense_claims set status='submitted' where id=$1`, [claimId]);
    const ap = await claimLines(claimId, 'abm');
    await owner.query(`update expense_claims set status='draft' where id=$1`, [claimId]);
    expect(ap.status).toBe(200);
    expect(ap.lines.filter((l) => l.origin === 'dcr')).toHaveLength(2);
    // Read shapes: detail and list.
    const g = await http().get(`/v1/dcrs/${d.body.id}`).set(as());
    expect([g.body.expenseClaimId, g.body.expenseTotal, g.body.expenseCount]).toEqual([
      claimId,
      150.25,
      2,
    ]);
    const l = await http().get(`/v1/dcrs?from=${today}&to=${today}`).set(as());
    const row = (l.body.items as { id: string; expenseCount: number }[]).find(
      (x) => x.id === d.body.id,
    );
    expect(row?.expenseCount).toBe(2);
    // Lines are owned by the DCR: no edit/delete through the claim.
    const del = await http().delete(`/v1/expense-claims/${claimId}/lines/${dl[0]!.id}`).set(as());
    expect([del.status, del.body.error.code, del.body.error.details.reason]).toEqual([
      409,
      'EXPENSE_NOT_EDITABLE',
      'DCR_LINE',
    ]);

    // Unlock/rejection -> resubmit: replaced, never duplicated.
    await reopen(d.body.id);
    const s2 = await submit(d.body.id, await version(d.body.id), {
      expenses: [{ category: 'hotel', amount: 900 }],
    });
    expect(s2.body.dcrExpenses).toMatchObject({ status: 'linked', lines: 1, total: 900 });
    expect((await liveDcrLines(d.body.id)).map((x) => [x.dcr_item_index, x.amount])).toEqual([
      [0, '900.00'],
    ]);
    // Resubmit without body expenses uses the saved list (idempotent).
    await reopen(d.body.id);
    await submit(d.body.id, await version(d.body.id));
    expect(await liveDcrLines(d.body.id)).toHaveLength(1);
    // some -> none removes them.
    await reopen(d.body.id);
    const s3 = await submit(d.body.id, await version(d.body.id), { expenses: [] });
    expect(s3.status).toBe(200);
    expect(await liveDcrLines(d.body.id)).toHaveLength(0);
    expect([s3.body.expenseClaimId, s3.body.expenseTotal, s3.body.expenseCount]).toEqual([
      null,
      0,
      0,
    ]);
    // none -> some.
    await reopen(d.body.id);
    const s4 = await submit(d.body.id, await version(d.body.id), {
      expenses: [{ category: 'other', amount: 10 }],
    });
    expect(s4.body.expenseCount).toBe(1);
  });

  it('no expenses and no claim: nothing is created', async () => {
    const d = await draft({}, 'peer');
    const s = await submit(d.body.id, d.body.version, {}, 'peer');
    expect(s.status).toBe(200);
    expect(s.body.dcrExpenses).toMatchObject({ status: 'skipped', reason: 'no_expenses' });
    expect(s.body.expenseClaimId).toBeNull();
  });

  it('locked claim: submit succeeds, claim_locked, nothing changed', async () => {
    const d = await draft({}, 'other');
    const month = today.slice(0, 7);
    const c = await http().post('/v1/expense-claims').set(as('other')).send({ month });
    expect(c.status).toBe(201);
    await owner.query(`update expense_claims set status='submitted' where id=$1`, [c.body.id]);
    const s = await submit(
      d.body.id,
      d.body.version,
      { expenses: [{ category: 'food', amount: 20 }] },
      'other',
    );
    expect(s.status).toBe(200);
    expect(s.body.dcrExpenses).toMatchObject({ status: 'skipped', reason: 'claim_locked' });
    expect(await liveDcrLines(d.body.id)).toHaveLength(0);
    expect(s.body.expenses).toEqual([{ category: 'food', amount: 20 }]);
  });

  it('tenant isolation: lines carry the owner company; peers cannot read the claim', async () => {
    const r = await owner.query(
      `select e.company_id, d.company_id as dcr_company from expense_lines e join dcrs d on d.id = e.dcr_id
        where e.origin='dcr' and d.user_id=$1`,
      [u.bm!.id],
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const x of r.rows) expect(x.company_id).toBe(x.dcr_company);
    const claim = await owner.query(`select id from expense_claims where user_id=$1`, [u.bm!.id]);
    expect((await claimLines(claim.rows[0].id, 'peer')).status).toBe(404);
    // The peer's DCR read fields never count someone else's lines.
    const l = await http().get(`/v1/dcrs?from=${today}&to=${today}`).set(as('peer'));
    for (const x of l.body.items as { expenseCount: number }[]) expect(x.expenseCount).toBe(0);
  });
});
