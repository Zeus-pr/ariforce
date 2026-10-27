/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignableRoles } from '../src';
import { createHandlers, fixtures as fx } from '../src/mocks';

const BASE = 'http://team.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const call = (who: string, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-mock-user': who, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const abm = fx.mockUsers.find((u) => u.roles[0] === 'area_business_manager')!;

describe('mock team + employees (same rules as the API)', () => {
  it('assignable roles are strictly below', () => {
    expect(assignableRoles(2)).toEqual(['business_manager']);
  });

  it('tree, create with invite, escalation blocked, accept', async () => {
    const tree = (await (await call('abm', 'GET', '/v1/team')).json()) as any;
    expect(tree.rootId).toBe(abm.id);
    expect(tree.nodes[0].depth).toBe(0);
    const body = {
      name: 'New BM',
      email: 'new.bm@demo.ariforce.in',
      role: 'business_manager',
      territoryIds: abm.territoryIds,
    };
    expect((await call('bm', 'POST', '/v1/employees', body)).status).toBe(403);
    expect(
      (await call('abm', 'POST', '/v1/employees', { ...body, role: 'area_business_manager' }))
        .status,
    ).toBe(403);
    expect(
      (await call('abm', 'POST', '/v1/employees', { ...body, role: 'system_admin' })).status,
    ).toBe(403);
    const ok = await call('abm', 'POST', '/v1/employees', body);
    expect(ok.status).toBe(201);
    const created = (await ok.json()) as any;
    expect(created.employee).toMatchObject({ status: 'invited', managerId: abm.id });
    expect(
      (await call('abm', 'PATCH', `/v1/employees/${abm.id}`, { version: 1, name: 'x' })).status,
    ).toBe(403);
    const token = new URL(created.invite.inviteUrl, BASE).searchParams.get('token');
    const acc = await call('none', 'POST', '/v1/invites/accept', {
      token,
      password: 'long-enough-12',
    });
    expect(acc.status).toBe(200);
    const again = await call('none', 'POST', '/v1/invites/accept', {
      token,
      password: 'long-enough-12',
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as any).error.code).toBe('INVITE_USED');
    const short = await call('none', 'POST', '/v1/invites/accept', {
      token,
      password: 'short-pw-11',
    });
    expect(short.status).toBe(422);
    const unknown = await call('none', 'POST', '/v1/invites/accept', {
      token: 'mock-invite-00000000-0000-0000-0000-000000000000',
      password: 'long-enough-12',
    });
    expect(((await unknown.json()) as any).error.code).toBe('INVITE_INVALID');
    const bulk = await call('abm', 'POST', '/v1/employees/invite-bulk', {
      employees: [
        { ...body, email: 'bulk1@demo.ariforce.in' },
        { ...body, email: 'BULK1@demo.ariforce.in' },
        { ...body, email: 'bulk2@demo.ariforce.in', role: 'system_admin' },
      ],
    });
    expect(bulk.status).toBe(200);
    const bj = (await bulk.json()) as any;
    expect(bj.summary).toEqual({ invited: 1, skipped: 1, failed: 1 });
    expect(bj.results.map((r: any) => r.code)).toEqual([null, 'DUPLICATE_IN_BATCH', 'FORBIDDEN']);
  });
});
