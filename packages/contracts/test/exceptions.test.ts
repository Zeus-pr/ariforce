/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXCEPTION_RULE_CODES,
  EXCEPTION_RULES,
  ExceptionItem,
  ExceptionListQuery,
  ExceptionRuleList,
  ExceptionSummary,
  ExceptionUpdate,
  TeamProfile,
} from '../src';
import { createHandlers } from '../src/mocks';

const BASE = 'http://exceptions.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const call = (who: string, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-mock-user': `${who}@demo.ariforce.in`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('exception contracts', () => {
  it('every rule has a default and thresholds sit inside their range', () => {
    for (const c of EXCEPTION_RULE_CODES) {
      const d = EXCEPTION_RULES[c];
      expect(d.action.length).toBeGreaterThan(0);
      if (d.threshold !== null) {
        expect(d.threshold).toBeGreaterThanOrEqual(d.thresholdMin ?? 0);
        expect(d.threshold).toBeLessThanOrEqual(d.thresholdMax ?? 1000);
      }
    }
    expect(ExceptionListQuery.parse({ status: 'open,acknowledged' }).status).toEqual([
      'open',
      'acknowledged',
    ]);
    expect(ExceptionListQuery.safeParse({ status: 'nope' }).success).toBe(false);
    expect(ExceptionListQuery.safeParse({ from: '2026-02-02', to: '2026-02-01' }).success).toBe(
      false,
    );
    expect(ExceptionUpdate.safeParse({}).success).toBe(false);
  });

  it('mock: list/summary/rules parse; bm explains, abm resolves, own close is forbidden', async () => {
    const list = (await (await call('abm', 'GET', '/v1/exceptions')).json()) as any;
    expect(list.items.length).toBeGreaterThan(0);
    list.items.forEach((x: unknown) => ExceptionItem.parse(x));
    const sev = list.items.map((x: any) => x.severity);
    expect(sev[0]).toBe('high');
    ExceptionSummary.parse(await (await call('abm', 'GET', '/v1/exceptions/summary')).json());
    const rules = ExceptionRuleList.parse(
      await (await call('abm', 'GET', '/v1/exception-rules')).json(),
    );
    expect(rules.items).toHaveLength(EXCEPTION_RULE_CODES.length);

    const id = list.items.find((x: any) => x.ruleCode === 'low_call_average').id;
    expect((await call('abm', 'POST', `/v1/exceptions/${id}/explain`, { note: 'x' })).status).toBe(
      403,
    );
    const ex = await call('bm', 'POST', `/v1/exceptions/${id}/explain`, { note: 'Conference' });
    expect(((await ex.json()) as any).status).toBe('acknowledged');
    expect((await call('bm', 'POST', `/v1/exceptions/${id}/resolve`, { note: 'ok' })).status).toBe(
      403,
    );
    const res = await call('abm', 'POST', `/v1/exceptions/${id}/resolve`, { note: 'ok' });
    expect(((await res.json()) as any).status).toBe('resolved');
    expect((await call('abm', 'POST', `/v1/exceptions/${id}/dismiss`, { note: 'x' })).status).toBe(
      409,
    );
  });

  it('mock: rule override, range check, reset; settings:write required', async () => {
    expect(
      (await call('abm', 'PUT', '/v1/exception-rules/low_call_average', { threshold: 6 })).status,
    ).toBe(403);
    const ok = (await (
      await call('director', 'PUT', '/v1/exception-rules/low_call_average', { threshold: 6 })
    ).json()) as any;
    expect(ok).toMatchObject({ threshold: 6, isDefault: false, version: 1 });
    expect(
      (await call('director', 'PUT', '/v1/exception-rules/dcr_missing', { threshold: 3 })).status,
    ).toBe(422);
    const reset = (await (
      await call('director', 'PUT', '/v1/exception-rules/low_call_average', { reset: true })
    ).json()) as any;
    expect(reset).toMatchObject({ isDefault: true, threshold: 8 });
  });

  it('mock: team profile carries exception counts', async () => {
    const me = (await (await call('bm', 'GET', '/v1/me')).json()) as any;
    const r = await call('abm', 'GET', `/v1/team/members/${me.id}/profile`);
    const prof = TeamProfile.parse(await r.json());
    expect(prof.exceptions?.last30Days).toBeGreaterThan(0);
  });
});
