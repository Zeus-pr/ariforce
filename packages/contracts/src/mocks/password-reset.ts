import { http, HttpResponse } from 'msw';
import {
  PASSWORD_RESET_ERROR_CODES as CODES,
  PASSWORD_RESET_MAX_ATTEMPTS,
  PasswordForgot,
  PasswordReset,
} from '../schemas/auth';
import * as fx from './fixtures';

/** The mock "emails" this code to every known mock user (there is no inbox in the mock). */
export const MOCK_PASSWORD_RESET_CODE = '123456';
const FORGOT_MESSAGE =
  'If an active account uses this email, a 6-digit code is on its way. It expires in 10 minutes.';

/**
 * Forgot password mock: same answers and error codes as the API. Simplifications: no expiry and no
 * rate limit; a code exists only after /forgot for a known mock user; after 3 wrong tries the next
 * try (even the right code) is 403 and the code is gone.
 */
export function passwordResetHandlers(baseUrl: string) {
  const pending = new Map<string, number>(); // email -> wrong tries so far
  const e = (status: number, code: string, message: string) =>
    HttpResponse.json({ error: { code, message } }, { status });
  return [
    http.post(`${baseUrl}/v1/auth/password/forgot`, async ({ request }) => {
      const b = PasswordForgot.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', 'Invalid email');
      const email = b.data.email.toLowerCase();
      if (fx.findMockUser(email)) pending.set(email, 0);
      return HttpResponse.json({ ok: true, message: FORGOT_MESSAGE });
    }),
    http.post(`${baseUrl}/v1/auth/password/reset`, async ({ request }) => {
      const b = PasswordReset.safeParse(await request.json().catch(() => null));
      if (!b.success) return e(422, 'VALIDATION', 'Invalid reset request');
      const email = b.data.email.toLowerCase();
      const tries = pending.get(email);
      if (tries === undefined) return e(400, CODES.invalid, 'The code is not valid');
      if (tries >= PASSWORD_RESET_MAX_ATTEMPTS) {
        pending.delete(email);
        return e(403, CODES.tooMany, 'Too many wrong codes; ask for a new one');
      }
      if (b.data.code !== MOCK_PASSWORD_RESET_CODE) {
        pending.set(email, tries + 1);
        return e(400, CODES.invalid, 'The code is not valid');
      }
      pending.delete(email);
      return HttpResponse.json({ ok: true });
    }),
  ];
}
