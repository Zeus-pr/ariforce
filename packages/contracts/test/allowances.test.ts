import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AllowanceDraftRequest,
  AllowanceDraftResult,
  AllowancePlace,
  AllowancePlaceInput,
  AllowanceRate,
  AllowanceRateInput,
  ExpenseClaim,
} from '../src';
import { createHandlers } from '../src/mocks';
import * as fx from '../src/mocks/fixtures';

const BASE = 'http://allowances.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const call = (who: string, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-mock-user': `${who}@demo.ariforce.in`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('TA/DA contracts (#39)', () => {
  it('validates rate, place and draft inputs', () => {
    const r = { band: 'hq', effectiveFrom: '2026-01-01', daAmount: 250, taPerKm: 0, taFixed: 100 };
    expect(AllowanceRateInput.parse(r).roleKey).toBeNull();
    expect(AllowanceRateInput.safeParse({ ...r, daAmount: 1.005 }).success).toBe(false);
    expect(AllowanceRateInput.safeParse({ ...r, band: 'none' }).success).toBe(false);
    const id = fx.territories[0]!.id;
    expect(
      AllowancePlaceInput.safeParse({ hqTerritoryId: id, name: 'X', band: 'hq', oneWayKm: 5 })
        .success,
    ).toBe(false);
    expect(
      AllowancePlaceInput.safeParse({ hqTerritoryId: id, name: 'X', band: 'ex_hq', oneWayKm: 0 })
        .success,
    ).toBe(false);
    expect(AllowanceDraftRequest.parse({})).toEqual({ dryRun: false, places: {} });
  });

  it('mock: rate card and fare chart CRUD with permissions', async () => {
    const body = {
      band: 'hq',
      effectiveFrom: '2000-01-01',
      daAmount: 250,
      taPerKm: 0,
      taFixed: 100,
    };
    expect((await call('bm', 'POST', '/v1/allowance-rates', body)).status).toBe(403);
    const c = await call('director', 'POST', '/v1/allowance-rates', body);
    expect(c.status).toBe(201);
    const rate = AllowanceRate.parse(await c.json());
    expect((await call('director', 'POST', '/v1/allowance-rates', body)).status).toBe(409);
    const stale = await call('director', 'PUT', `/v1/allowance-rates/${rate.id}`, {
      ...body,
      daAmount: 300,
      version: 9,
    });
    expect(stale.status).toBe(409);
    expect((await call('bm', 'GET', '/v1/allowance-rates?band=hq')).status).toBe(200);

    const place = {
      hqTerritoryId: fx.territories[3]!.id,
      name: 'Barasat',
      band: 'ex_hq',
      oneWayKm: 25,
    };
    const pc = await call('director', 'POST', '/v1/allowance-places', place);
    expect(pc.status).toBe(201);
    expect(AllowancePlace.parse(await pc.json()).hqName).toBe(fx.territories[3]!.name);
    expect(
      (await call('director', 'POST', '/v1/allowance-places', { ...place, name: 'BARASAT' }))
        .status,
    ).toBe(409);
    const list = (await (await call('bm', 'GET', '/v1/allowance-places?q=bara')).json()) as {
      items: unknown[];
    };
    expect(list.items).toHaveLength(1);
  });

  it('mock: draft replaces auto lines, keeps manual ones, dryRun writes nothing', async () => {
    // Last month: every weekday is in the past, whatever today is.
    const d = new Date();
    const month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7);
    const cr = await call('bm', 'POST', '/v1/expense-claims', { month });
    expect([200, 201]).toContain(cr.status);
    const claim = ExpenseClaim.parse(await cr.json());
    const dry = AllowanceDraftResult.parse(
      await (
        await call('bm', 'POST', `/v1/expense-claims/${claim.id}/allowances`, { dryRun: true })
      ).json(),
    );
    expect(dry.claim).toBeNull();
    expect(dry.days.length).toBeGreaterThan(0);
    expect(dry.days.every((d) => d.da === 250 && d.ta === 100)).toBe(true);
    // A manual DA on the first weekday: that day is skipped (manual_line_exists), the line kept.
    const first = dry.days[0]!.date;
    const ml = await call('bm', 'POST', `/v1/expense-claims/${claim.id}/lines`, {
      date: first,
      category: 'allowance',
      amount: 400,
      notes: null,
      mileageKm: null,
      dcrId: null,
      tourPlanId: null,
    });
    expect(ml.status).toBe(201);
    const run = async () =>
      AllowanceDraftResult.parse(
        await (await call('bm', 'POST', `/v1/expense-claims/${claim.id}/allowances`, {})).json(),
      );
    const a = await run();
    const b = await run(); // re-run is idempotent: auto lines replaced, not duplicated
    expect(b.claim!.lines).toHaveLength(a.claim!.lines.length);
    expect(b.claim!.lines.filter((l) => l.source === 'manual')).toHaveLength(1);
    expect(b.days[0]!.issues).toEqual(['manual_line_exists']);
    expect(b.totals.da).toBe(250 * (dry.days.length - 1));
    expect(
      (await call('director', 'POST', `/v1/expense-claims/${claim.id}/allowances`, {})).status,
    ).not.toBe(200);
  });
});
