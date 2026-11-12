/* eslint-disable @typescript-eslint/no-explicit-any */
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD_RESET_ERROR_CODES as CODES, PasswordReset } from '../src';
import { MOCK_PASSWORD_RESET_CODE, createHandlers, fixtures as fx } from '../src/mocks';

const BASE = 'http://pwreset.test';
const server = setupServer(...createHandlers(BASE));
beforeAll(() => server.listen());
afterAll(() => server.close());
const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const pw = 'A-new-long-password-1';

describe('forgot password contracts (item F)', () => {
  it('schema: 6-digit code, password min 12', () => {
    const ok = { email: 'a@example.com', code: '012345', password: pw };
    expect(PasswordReset.safeParse(ok).success).toBe(true);
    expect(PasswordReset.safeParse({ ...ok, code: '12345' }).success).toBe(false);
    expect(PasswordReset.safeParse({ ...ok, code: '12345a' }).success).toBe(false);
    expect(PasswordReset.safeParse({ ...ok, password: 'short-11chr' }).success).toBe(false);
  });

  it('mock: generic forgot, wrong code, 3 tries, success', async () => {
    const email = fx.mockUsers[0]!.email;
    const known = await (await post('/v1/auth/password/forgot', { email })).json();
    const unknown = await (
      await post('/v1/auth/password/forgot', { email: 'nobody@example.com' })
    ).json();
    expect(known).toEqual(unknown);
    const bad = await post('/v1/auth/password/reset', { email, code: '000000', password: pw });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error.code).toBe(CODES.invalid);
    await post('/v1/auth/password/reset', { email, code: '000000', password: pw });
    await post('/v1/auth/password/reset', { email, code: '000000', password: pw });
    const fourth = await post('/v1/auth/password/reset', {
      email,
      code: MOCK_PASSWORD_RESET_CODE,
      password: pw,
    });
    expect(fourth.status).toBe(403);
    expect(((await fourth.json()) as any).error.code).toBe(CODES.tooMany);
    await post('/v1/auth/password/forgot', { email });
    const good = await post('/v1/auth/password/reset', {
      email,
      code: MOCK_PASSWORD_RESET_CODE,
      password: pw,
    });
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({ ok: true });
    const nobody = await post('/v1/auth/password/reset', {
      email: 'nobody@example.com',
      code: MOCK_PASSWORD_RESET_CODE,
      password: pw,
    });
    expect(((await nobody.json()) as any).error.code).toBe(CODES.invalid);
  });
});
