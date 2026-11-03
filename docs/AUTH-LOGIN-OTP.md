# Sign-in OTP (emailed code after the password)

Every user enters a 6-digit code, sent by email, after a correct password. Built on better-auth's
`twoFactor` plugin with email OTP only (no authenticator app, no backup codes).

## How it works

1. `POST /v1/auth/sign-in/email` with a correct password answers `{ "twoFactorRedirect": true }` and a
   signed `two_factor` challenge cookie. The password-only session is deleted at once, so the
   `set-auth-token` echoed in that response is already dead.
2. `POST /v1/auth/two-factor/send-otp` mails the code (kind `login_code`, sender `MAIL_FROM`).
3. `POST /v1/auth/two-factor/verify-otp` `{ "code" }` creates the real session. Audit: `auth.sign_in` is
   written here, once.

Limits: code 6 digits, hashed at rest, 5 minutes, 3 tries per code, single use, account lock after
10 consecutive wrong codes, challenge valid 10 minutes, `/two-factor/*` rate limited per IP.
Pending, rejected, suspended and retired-role accounts are refused at step 1 and get no code.
Authenticator and backup-code routes answer 404 (`bootstrap.ts`).

## Switch

`LOGIN_OTP=on` (also `1`, `true`) on the API turns it on. Unset = password only (current behaviour).
The switch is the rollback: unset it and redeploy.

## Database

Migration `0053_login_otp` (additive): `auth_user.two_factor_enabled` (default true, so everyone is
covered, including new users) and `auth_two_factor` (required by the plugin; stays empty).
Apply it before deploying code that sets `LOGIN_OTP`.

## Clients

- Web: `apps/web/src/lib/mock-auth.ts` (`signInReal`, `verifyLoginOtp`, `resendLoginOtp`) and the code
  step in `sign-in-form.tsx`. Browser cookies carry the challenge.
- Mobile: `apps/mobile/src/lib/auth-api.ts`. The app uses bearer tokens and no cookie jar, so it reads
  the `two_factor` cookie from the sign-in response and sends it back by hand with an `Origin` taken
  from `EXPO_PUBLIC_AUTH_ORIGIN` (must be in the API's `WEB_ORIGIN`). Needs a device test.

## Rollout order (production)

1. Resend: `arighnapharma.com` verified (done), `MAIL_FROM` on that domain, `RESEND_API_KEY` set.
2. Apply migration 0053 (the lead, via the Supabase connector).
3. Deploy API with `LOGIN_OTP` unset. Deploy web.
4. Ship the mobile build with the code step. **Old mobile builds cannot sign in once the switch is
   on**, so release and adopt the new build first.
5. Set `LOGIN_OTP=on`, redeploy the API, sign in on web and mobile.

## Tests

`apps/api/test/login-otp.test.ts` (needs the throwaway DB: `sh scripts/test-db.sh up`).
