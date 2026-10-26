import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Me } from '../src';
import { createHandlers } from '../src/mocks';

const BASE = 'http://mockauth.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const me = (headers: Record<string, string> = {}) => fetch(`${BASE}/v1/me`, { headers });

describe('mock auth personas', () => {
  it('defaults to the director', async () => {
    expect(((await (await me()).json()) as Me).roles).toEqual(['director']);
  });
  it('honours x-mock-user by role key, email or local part', async () => {
    expect(((await (await me({ 'x-mock-user': 'business_manager' })).json()) as Me).roles).toEqual([
      'business_manager',
    ]);
    const sa = (await (await me({ 'x-mock-user': 'sysadmin@demo.ariforce.in' })).json()) as Me;
    expect(sa.roles).toEqual(['system_admin']);
    expect(sa.permissions).not.toContain('field:read');
    expect((await me({ 'x-mock-user': 'none' })).status).toBe(401);
  });
  it('sign-in returns a mock token honoured as bearer', async () => {
    const r = await fetch(`${BASE}/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'rbm@demo.ariforce.in', password: 'whatever-123' }),
    });
    const t = r.headers.get('set-auth-token');
    expect(t).toBe('mock:regional_business_manager');
    const u = (await (await me({ authorization: `Bearer ${t}` })).json()) as Me;
    expect(u.roles).toEqual(['regional_business_manager']);
    expect(u.managerId).toBeTruthy();
    const bad = await fetch(`${BASE}/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@x.in', password: 'whatever-123' }),
    });
    expect(bad.status).toBe(401);
  });
});
