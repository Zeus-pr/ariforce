/**
 * Mock mode only: forgot-password by email code. Every email "gets" code 123456.
 * Test hooks by email: contains "expired" -> PASSWORD_RESET_CODE_EXPIRED; "slow" -> 429 on send; "busy" -> 429 on reset.
 * Three wrong codes for one email -> PASSWORD_RESET_TOO_MANY_ATTEMPTS until a new code is sent.
 */
import { http, HttpResponse } from 'msw';
import { INVITE_PASSWORD_MIN } from '@ariforce/contracts';

export const MOCK_RESET_CODE = '123456';
const wrong = new Map<string, number>();
const sent = new Set<string>();
const err = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  HttpResponse.json({ error: { code, message } }, { status, headers });

export function mockPasswordReset(base: string) {
  return [
    http.post(`${base}/v1/auth/password/forgot`, async ({ request }) => {
      const b = (await request.json().catch(() => null)) as { email?: string } | null;
      const email = b?.email ?? '';
      if (email.includes('slow'))
        return err(429, 'RATE_LIMITED', 'Too many requests', { 'Retry-After': '30' });
      sent.add(email);
      wrong.delete(email);
      return HttpResponse.json({ ok: true, message: 'If an active account uses this email, a 6-digit code is on its way. It expires in 10 minutes.' });
    }),
    http.post(`${base}/v1/auth/password/reset`, async ({ request }) => {
      const b = (await request.json().catch(() => null)) as {
        email?: string;
        code?: string;
        password?: string;
      } | null;
      const email = b?.email ?? '';
      if (email.includes('busy'))
        return err(429, 'RATE_LIMITED', 'Too many requests', { 'Retry-After': '45' });
      if ((wrong.get(email) ?? 0) >= 3) return err(403, 'PASSWORD_RESET_TOO_MANY_ATTEMPTS', 'Too many attempts');
      if (!sent.has(email) || email.includes('expired'))
        return err(400, 'PASSWORD_RESET_CODE_EXPIRED', 'Code expired');
      if (b?.code !== MOCK_RESET_CODE) {
        const n = (wrong.get(email) ?? 0) + 1;
        wrong.set(email, n);
        return n >= 3
          ? err(403, 'PASSWORD_RESET_TOO_MANY_ATTEMPTS', 'Too many attempts')
          : err(400, 'PASSWORD_RESET_CODE_INVALID', 'The code is not valid');
      }
      if (!b.password || b.password.length < INVITE_PASSWORD_MIN || b.password.length > 128)
        return err(
          422,
          'VALIDATION',
          `Password must be at least ${INVITE_PASSWORD_MIN} characters`,
        );
      sent.delete(email);
      wrong.delete(email);
      return HttpResponse.json({ status: true });
    }),
  ];
}
