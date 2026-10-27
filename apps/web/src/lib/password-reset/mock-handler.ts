/**
 * Mock mode only: forgot-password by email code. Every email "gets" code 246810.
 * Test hooks by email: contains "expired" -> OTP_EXPIRED; "slow" -> 429 on send; "busy" -> 429 on reset.
 * Three wrong codes for one email -> TOO_MANY_ATTEMPTS until a new code is sent.
 */
import { http, HttpResponse } from 'msw';
import { INVITE_PASSWORD_MIN } from '@ariforce/contracts';

export const MOCK_RESET_CODE = '246810';
const wrong = new Map<string, number>();
const sent = new Set<string>();
const err = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  HttpResponse.json({ code, message }, { status, headers });

export function mockPasswordReset(base: string) {
  return [
    http.post(`${base}/v1/auth/email-otp/send-verification-otp`, async ({ request }) => {
      const b = (await request.json().catch(() => null)) as { email?: string } | null;
      const email = b?.email ?? '';
      if (email.includes('slow'))
        return err(429, 'RATE_LIMITED', 'Too many requests', { 'Retry-After': '30' });
      sent.add(email);
      wrong.delete(email);
      return HttpResponse.json({ success: true });
    }),
    http.post(`${base}/v1/auth/email-otp/reset-password`, async ({ request }) => {
      const b = (await request.json().catch(() => null)) as {
        email?: string;
        otp?: string;
        password?: string;
      } | null;
      const email = b?.email ?? '';
      if (email.includes('busy'))
        return err(429, 'RATE_LIMITED', 'Too many requests', { 'Retry-After': '45' });
      if ((wrong.get(email) ?? 0) >= 3) return err(403, 'TOO_MANY_ATTEMPTS', 'Too many attempts');
      if (!sent.has(email) || email.includes('expired'))
        return err(400, 'OTP_EXPIRED', 'OTP expired');
      if (b?.otp !== MOCK_RESET_CODE) {
        const n = (wrong.get(email) ?? 0) + 1;
        wrong.set(email, n);
        return n >= 3
          ? err(403, 'TOO_MANY_ATTEMPTS', 'Too many attempts')
          : err(400, 'INVALID_OTP', 'Invalid OTP');
      }
      if (!b.password || b.password.length < INVITE_PASSWORD_MIN)
        return err(
          400,
          'PASSWORD_TOO_SHORT',
          `Password must be at least ${INVITE_PASSWORD_MIN} characters`,
        );
      sent.delete(email);
      wrong.delete(email);
      return HttpResponse.json({ status: true });
    }),
  ];
}
