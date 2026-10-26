/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH_STATE_CODES, SignupRequestCreate } from '../src';
import { createHandlers, fixtures as fx } from '../src/mocks';

const BASE = 'http://signup.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const call = (who: string | null, method: string, path: string, body?: unknown) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(who ? { 'x-mock-user': who } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const base = {
  name: 'Self Signup',
  email: 'self.signup@example.com',
  phone: null,
  password: 'long-enough-pass',
  requestedRole: 'business_manager',
  territoryId: null,
  managerId: null,
};

describe('sign-up request contracts', () => {
  it('schema rules', () => {
    expect(SignupRequestCreate.safeParse(base).success).toBe(true);
    expect(SignupRequestCreate.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(SignupRequestCreate.safeParse({ ...base, requestedRole: 'system_admin' }).success).toBe(
      false,
    );
  });

  it('mock: request -> pending sign-in -> approve -> sign-in; reject; enumeration', async () => {
    const r = await call(null, 'POST', '/v1/auth/sign-up-request', base);
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).status).toBe('pending');
    const dup = await call(null, 'POST', '/v1/auth/sign-up-request', base);
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as any).error.code).toBe(AUTH_STATE_CODES.unavailable);
    const known = fx.mockUsers[0]!.email;
    expect(
      (await call(null, 'POST', '/v1/auth/sign-up-request', { ...base, email: known })).status,
    ).toBe(409);

    const signIn = () =>
      call(null, 'POST', '/v1/auth/sign-in/email', { email: base.email, password: base.password });
    let s = await signIn();
    expect(s.status).toBe(403);
    expect(((await s.json()) as any).code).toBe(AUTH_STATE_CODES.pending);

    expect((await call('business_manager', 'GET', '/v1/signup-requests')).status).toBe(403);
    const list = (await (
      await call('area_business_manager', 'GET', '/v1/signup-requests')
    ).json()) as any;
    const id = list.items.find((x: any) => x.email === base.email).id;
    const esc = await call('area_business_manager', 'POST', `/v1/signup-requests/${id}/approve`, {
      role: 'director',
    });
    expect(esc.status).toBe(403);
    const ok = await call('area_business_manager', 'POST', `/v1/signup-requests/${id}/approve`, {
      role: 'business_manager',
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).status).toBe('approved');
    expect(
      (await call('system_admin', 'POST', `/v1/signup-requests/${id}/reject`, {})).status,
    ).toBe(409);
    s = await signIn();
    expect(s.status).toBe(200);

    const b2 = { ...base, email: 'second@example.com' };
    await call(null, 'POST', '/v1/auth/sign-up-request', b2);
    const l2 = (await (await call('system_admin', 'GET', '/v1/signup-requests')).json()) as any;
    const id2 = l2.items.find((x: any) => x.email === b2.email).id;
    const rej = await call('system_admin', 'POST', `/v1/signup-requests/${id2}/reject`, {
      reason: 'no',
    });
    expect(((await rej.json()) as any).reason).toBe('no');
    const s2 = await call(null, 'POST', '/v1/auth/sign-in/email', {
      email: b2.email,
      password: 'x',
    });
    expect(((await s2.json()) as any).code).toBe(AUTH_STATE_CODES.rejected);
  });
});
