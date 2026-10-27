import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID as A, U } from '@ariforce/db';
import { AllowanceDraftResult, AllowancePlace, AllowanceRate } from '@ariforce/contracts';
import { bearerFor } from './support';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

const OWNER = process.env.DIRECT_URL;
const APP = process.env.DATABASE_URL;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'ariforce-demo-pass';
// Far past, offset per run so re-runs on one DB do not overlap (exceptions test uses 1960+).
const Y = 1920 + (Date.now() % 30);
const M = `${Y}-05`;
const D = (n: number) => `${Y}-05-${String(n).padStart(2, '0')}`;
const WT = {
  hq: '01930000-0000-7000-8000-900000000001',
  exhq: '01930000-0000-7000-8000-900000000002',
  out: '01930000-0000-7000-8000-900000000003',
  meeting: '01930000-0000-7000-8000-900000000004',
};
const HQ = '01930000-0000-7000-8000-100000000005';
const BM = U.rep;

describe.skipIf(!OWNER || !APP)('TA/DA allowances (real API)', () => {
  let app: INestApplication;
  let owner: Pool;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ authorization: tok[who]! });
  const made = { rates: [] as AllowanceRate[], places: [] as AllowancePlace[] };
  const dcr = async (d: string, wt: string, submitted = true) =>
    (
      await owner.query(
        `insert into dcrs (id, company_id, user_id, date, work_type_id, status, submitted_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [uuidv7(), A, BM, d, wt, submitted ? 'submitted' : 'draft', submitted ? new Date() : null],
      )
    ).rows[0].id as string;
  const rate = async (body: object, who = 'director') => {
    const r = await http().post('/v1/allowance-rates').set(as(who)).send(body);
    if (r.status === 201) made.rates.push(r.body);
    return r;
  };
  const place = async (body: object, who = 'director') => {
    const r = await http().post('/v1/allowance-places').set(as(who)).send(body);
    if (r.status === 201) made.places.push(r.body);
    return r;
  };
  let claimId: string;
  let roleKey: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ bodyParser: false }));
    await app.init();
    owner = new Pool({ connectionString: OWNER });
    for (const who of ['bm', 'bm2', 'director', 'accountant']) {
      tok[who] = await bearerFor(http, who, PASSWORD);
    }
    roleKey = (
      await owner.query(
        `select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 limit 1`,
        [BM],
      )
    ).rows[0].key;
  });

  afterAll(async () => {
    for (const p of made.places)
      await http().delete(`/v1/allowance-places/${p.id}`).set(as('director'));
    for (const r of made.rates)
      await http().delete(`/v1/allowance-rates/${r.id}`).set(as('director'));
    await owner?.end();
    await app?.close();
  });

  it('rate card: create, validation, duplicate, permissions', async () => {
    const base = { effectiveFrom: `${Y}-01-01`, taPerKm: 0, taFixed: 0, daAmount: 0 };
    expect((await rate({ ...base, band: 'hq', daAmount: 200, taFixed: 50 })).status).toBe(201);
    expect((await rate({ ...base, band: 'ex_hq', daAmount: 300, taPerKm: 2.5 })).status).toBe(201);
    expect(
      (await rate({ ...base, band: 'outstation', daAmount: 500, taPerKm: 2, taFixed: 100 })).status,
    ).toBe(201);
    // Role-specific ex-HQ rate effective mid-month wins from that day on.
    const role = await rate({
      ...base,
      band: 'ex_hq',
      roleKey,
      effectiveFrom: D(15),
      daAmount: 350,
      taPerKm: 3,
    });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    expect(AllowanceRate.parse(role.body).roleKey).toBe(roleKey);

    const dup = await rate({ ...base, band: 'hq', daAmount: 1 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_RATE');
    expect((await rate({ ...base, band: 'none', daAmount: 1 })).status).toBe(422);
    expect((await rate({ ...base, band: 'hq', daAmount: -1, effectiveFrom: D(2) })).status).toBe(
      422,
    );
    expect((await rate({ ...base, band: 'hq', roleKey: 'nope', effectiveFrom: D(3) })).status).toBe(
      422,
    );
    expect((await rate({ ...base, band: 'hq', effectiveFrom: D(4) }, 'bm')).status).toBe(403);

    const list = await http().get('/v1/allowance-rates').query({ band: 'ex_hq' }).set(as('bm'));
    expect(list.status).toBe(200);
    expect(list.body.items.some((r: AllowanceRate) => r.id === role.body.id)).toBe(true);

    const stale = await http()
      .put(`/v1/allowance-rates/${role.body.id}`)
      .set(as('director'))
      .send({
        ...base,
        band: 'ex_hq',
        roleKey,
        effectiveFrom: D(15),
        daAmount: 350,
        taPerKm: 3,
        version: 99,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('fare chart: create, HQ check, duplicate name', async () => {
    const a = await place({ hqTerritoryId: HQ, name: `Alpha ${Y}`, band: 'ex_hq', oneWayKm: 40 });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    ids.alpha = a.body.id;
    ids.beta = (
      await place({ hqTerritoryId: HQ, name: `Beta ${Y}`, band: 'ex_hq', oneWayKm: 25 })
    ).body.id;
    ids.gamma = (
      await place({ hqTerritoryId: HQ, name: `Gamma ${Y}`, band: 'outstation', oneWayKm: 150 })
    ).body.id;
    const dup = await place({ hqTerritoryId: HQ, name: `alpha ${Y}`, band: 'ex_hq', oneWayKm: 1 });
    expect(dup.body.error.code).toBe('DUPLICATE_PLACE');
    const notHq = await place({ hqTerritoryId: uuidv7(), name: 'X', band: 'ex_hq', oneWayKm: 1 });
    expect(notHq.status).toBe(422);
    expect(notHq.body.error.code).toBe('NOT_HQ_TERRITORY');
    expect((await place({ hqTerritoryId: HQ, name: 'Y', band: 'hq', oneWayKm: 1 })).status).toBe(
      422,
    );
    expect((await place({ hqTerritoryId: HQ, name: 'Z', band: 'ex_hq', oneWayKm: 0 })).status).toBe(
      422,
    );
    expect(
      (await place({ hqTerritoryId: HQ, name: 'W', band: 'ex_hq', oneWayKm: 9 }, 'bm')).status,
    ).toBe(403);
    const list = await http()
      .get('/v1/allowance-places')
      .query({ hqTerritoryId: HQ, q: String(Y) })
      .set(as('bm'));
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: AllowancePlace) => p.name).sort()).toEqual(
      [`Alpha ${Y}`, `Beta ${Y}`, `Gamma ${Y}`].sort(),
    );
  });

  it('drafts DA/TA per DCR day; dry run writes nothing', async () => {
    ids.d1 = await dcr(D(4), WT.hq);
    ids.d2 = await dcr(D(5), WT.exhq);
    ids.d3 = await dcr(D(6), WT.out);
    await dcr(D(7), WT.meeting);
    await dcr(D(8), WT.exhq, false);
    ids.d9 = await dcr(D(18), WT.exhq);
    const c = await http().post('/v1/expense-claims').set(as('bm')).send({ month: M });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    claimId = c.body.id;

    const dry = await http()
      .post(`/v1/expense-claims/${claimId}/allowances`)
      .set(as('bm'))
      .send({ dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    const r = AllowanceDraftResult.parse(dry.body);
    expect(r.claim).toBeNull();
    const day = (d: string) => r.days.find((x) => x.date === d)!;
    expect(day(D(4))).toMatchObject({ band: 'hq', da: 200, ta: 50, km: null, issues: [] });
    expect(day(D(5))).toMatchObject({ band: 'ex_hq', da: 300, ta: 0, issues: ['place_required'] });
    expect(day(D(6))).toMatchObject({
      band: 'outstation',
      placeId: ids.gamma,
      km: 300,
      da: 500,
      ta: 700,
    });
    expect(day(D(7))).toBeUndefined();
    expect(day(D(8)).issues).toEqual(['dcr_not_submitted']);
    expect(day(D(18))).toMatchObject({ da: 350, issues: ['place_required'] });
    const lines = await http().get(`/v1/expense-claims/${claimId}`).set(as('bm'));
    expect(lines.body.lines ?? []).toHaveLength(0);
  });

  it('writes auto lines, remembers places on rerun, rejects bad places', async () => {
    const bad = await http()
      .post(`/v1/expense-claims/${claimId}/allowances`)
      .set(as('bm'))
      .send({ places: { [D(5)]: uuidv7() } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('PLACE_NOT_USABLE');
    const mismatch = await http()
      .post(`/v1/expense-claims/${claimId}/allowances`)
      .set(as('bm'))
      .send({ places: { [D(5)]: ids.gamma } });
    expect(mismatch.body.error.code).toBe('PLACE_NOT_USABLE');

    const res = await http()
      .post(`/v1/expense-claims/${claimId}/allowances`)
      .set(as('bm'))
      .send({ places: { [D(5)]: ids.alpha, [D(18)]: ids.beta } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = AllowanceDraftResult.parse(res.body);
    // D4 200+50, D5 300+80*2.5, D6 500+700, D18 350+50*3
    expect(r.totals).toEqual({ da: 1350, ta: 1100, km: 430, lines: 8 });
    expect(r.claim!.total).toBe(2450);
    const auto = r.claim!.lines.filter((l) => l.source === 'auto');
    expect(auto).toHaveLength(8);
    expect(auto.find((l) => l.date === D(5) && l.category === 'mileage')).toMatchObject({
      amount: 200,
      mileageKm: 80,
      allowancePlaceId: ids.alpha,
      dcrId: ids.d2,
    });
    expect(auto.find((l) => l.date === D(4) && l.category === 'travel')?.amount).toBe(50);

    const again = AllowanceDraftResult.parse(
      (await http().post(`/v1/expense-claims/${claimId}/allowances`).set(as('bm')).send({})).body,
    );
    expect(again.totals).toEqual(r.totals);
    expect(again.claim!.lines.filter((l) => l.source === 'auto')).toHaveLength(8);
  });

  it('manual edits are kept and skip the day', async () => {
    const claim = (await http().get(`/v1/expense-claims/${claimId}`).set(as('bm'))).body;
    const line = claim.lines.find(
      (l: { date: string; category: string }) => l.date === D(5) && l.category === 'mileage',
    );
    const upd = await http()
      .put(`/v1/expense-claims/${claimId}/lines/${line.id}`)
      .set(as('bm'))
      .send({
        line: { date: D(5), category: 'mileage', amount: 210, mileageKm: 165, notes: 'detour' },
        version: line.version,
      });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(
      upd.body.source ?? upd.body.lines?.find((l: { id: string }) => l.id === line.id)?.source,
    ).toBe('manual');

    const r = AllowanceDraftResult.parse(
      (await http().post(`/v1/expense-claims/${claimId}/allowances`).set(as('bm')).send({})).body,
    );
    expect(r.days.find((d) => d.date === D(5))!.issues).toEqual(['manual_line_exists']);
    const d5 = r.claim!.lines.filter((l) => l.date === D(5));
    expect(d5).toHaveLength(1);
    expect(d5[0]).toMatchObject({ source: 'manual', amount: 210 });
  });

  it('scope: only the owner, only editable claims', async () => {
    expect([403, 404]).toContain(
      (await http().post(`/v1/expense-claims/${claimId}/allowances`).set(as('director')).send({}))
        .status,
    );
    expect([403, 404]).toContain(
      (await http().post(`/v1/expense-claims/${claimId}/allowances`).set(as('bm2')).send({}))
        .status,
    );
    expect(
      (
        await http()
          .post(`/v1/expense-claims/${claimId}/allowances`)
          .set(as('bm'))
          .send({ dryRun: 'x' })
      ).status,
    ).toBe(422);
    const audit = await owner.query(
      `select count(*)::int as n from audit_log where entity_id = $1 and action = 'expense.allowances_drafted'`,
      [claimId],
    );
    expect(audit.rows[0].n).toBe(3);
    // Retired accountant: legacy finance:read no longer opens the rate card; never writes it.
    expect((await http().get('/v1/allowance-rates').set(as('accountant'))).status).toBe(403);
    expect((await http().post('/v1/allowance-rates').set(as('accountant')).send({})).status).toBe(
      403,
    );
  });
});
