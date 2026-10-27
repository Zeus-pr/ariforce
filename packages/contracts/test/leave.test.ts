/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, LeaveApply, LeaveGrantCreate } from '../src';
import { createHandlers } from '../src/mocks';

const BASE = 'http://leave.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const call = (who: string, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-mock-user': `${who}@demo.ariforce.in`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('leave contracts', () => {
  it('apply rules', () => {
    const b = { typeCode: 'CL', fromDate: '2030-03-04', toDate: '2030-03-04' };
    expect(LeaveApply.safeParse(b).success).toBe(true);
    expect(LeaveApply.safeParse({ ...b, toDate: '2030-03-03' }).success).toBe(false);
    expect(LeaveApply.safeParse({ ...b, toDate: '2030-03-05', half: 'am' }).success).toBe(false);
    const g = {
      userId: '00000000-0000-4000-8000-000000000001',
      typeCode: 'COMP',
      year: 2030,
      reason: 'x',
    };
    expect(LeaveGrantCreate.safeParse({ ...g, days: 1 }).success).toBe(true);
    expect(LeaveGrantCreate.safeParse({ ...g, days: -1 }).success).toBe(false);
    expect(LeaveGrantCreate.safeParse({ ...g, days: -1, kind: 'adjustment' }).success).toBe(true);
  });

  it('permissions: field line has leave, functional roles do not', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.business_manager).toContain('leave:write');
    expect(DEFAULT_ROLE_PERMISSIONS.business_manager).not.toContain('leave:approve');
    expect(DEFAULT_ROLE_PERMISSIONS.area_business_manager).toContain('leave:approve');
    expect(DEFAULT_ROLE_PERMISSIONS.accountant ?? []).not.toContain('leave:read');
  });

  it('mock flow: types, apply, balances, decide', async () => {
    const t: any = await (await call('bm', 'GET', '/v1/leave/types')).json();
    expect(t.items.map((x: { code: string }) => x.code)).toEqual(['CL', 'SL', 'EL', 'LOP', 'COMP']);
    const r = await call('bm', 'POST', '/v1/leave/requests', {
      typeCode: 'CL',
      fromDate: '2030-03-04',
      toDate: '2030-03-10',
    });
    expect(r.status).toBe(201);
    const req: any = await r.json();
    expect(req.days).toBe(6);
    const again = await call('bm', 'POST', '/v1/leave/requests', {
      typeCode: 'SL',
      fromDate: '2030-03-05',
      toDate: '2030-03-05',
    });
    expect(((await again.json()) as any).error.code).toBe('LEAVE_OVERLAP');
    expect(
      (await call('bm', 'POST', `/v1/leave/requests/${req.id}/decision`, { decision: 'approve' }))
        .status,
    ).toBe(403);
    const ok = await call('abm', 'POST', `/v1/leave/requests/${req.id}/decision`, {
      decision: 'approve',
    });
    expect(((await ok.json()) as any).status).toBe('approved');
    const b: any = await (await call('bm', 'GET', '/v1/leave/balances?year=2030')).json();
    expect(b.items.find((i: { typeCode: string }) => i.typeCode === 'CL')).toMatchObject({
      used: 6,
      available: 6,
    });
  });
});
