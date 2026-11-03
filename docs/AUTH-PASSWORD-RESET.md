# Forgot password (email code) and invite email

Item F (`feat/auth-email-otp`). Mail goes through `MailService` (`apps/api/src/mail/mail.service.ts`):
Resend when `RESEND_API_KEY` is set, otherwise a log line with the kind and recipient only (never a
code, token or link). Tests replace the `MAIL_SENDER` provider with a capturing fake; nothing is sent.

## Endpoints (public, Nest; not better-auth's router)

### `POST /v1/auth/password/forgot`

Request `{ "email": string }`. Response `200 { "ok": true, "message": "If an active account uses this
email, a 6-digit code is on its way. It expires in 10 minutes." }`, the same for every email.

- A code is emailed only when the account is eligible: an auth identity exists, the employee is
  `active` (not suspended, pending, rejected, or invited and never signed in) and holds at least one
  non-retired role. Others get the same answer and no email.
- Code: 6 digits, valid 10 minutes, stored hashed (better-auth `emailOTP`, type `forget-password`). A
  new request replaces the previous code.
- `422 VALIDATION` bad email. `429 RATE_LIMITED` (+ `Retry-After`): 3 per email per hour
  (`PASSWORD_RESET_RATE_PER_EMAIL`) and 10 per IP per hour (`PASSWORD_RESET_RATE_PER_IP`). The email
  key is a SHA-256 hash; the limit applies to unknown emails too, so 429 reveals nothing.
- The email is sent without awaiting, so response time does not reveal eligibility.
- Audit `auth.password_reset_requested` (eligible accounts only).

### `POST /v1/auth/password/reset`

Request `{ "email": string, "code": "######", "password": string (12-128) }`. Response `200 { "ok": true }`.

- Same password rule as invite accept (min 12). On success every session of the user is revoked
  (`revokeSessionsOnPasswordReset`); the client must sign in again. Audit
  `auth.password_reset_completed`.
- `400 PASSWORD_RESET_CODE_INVALID`: wrong code, no code requested, code already used, or no
  eligible account (same answer, no enumeration).
- `400 PASSWORD_RESET_CODE_EXPIRED`: older than 10 minutes (the code is deleted).
- `403 PASSWORD_RESET_TOO_MANY_ATTEMPTS`: 3 wrong codes used the code up; the 4th try is refused even
  with the right code. Request a new code.
- `422 VALIDATION` (email, 6 digits, password length). `429 RATE_LIMITED`: 20 per IP per hour.

Constants are exported from `@ariforce/contracts` (`PASSWORD_RESET_*`, `PASSWORD_RESET_ERROR_CODES`).
The MSW mock accepts code `MOCK_PASSWORD_RESET_CODE` (`123456`) after `/forgot` for a mock user.

### Blocked better-auth routes

`/v1/auth/email-otp/*`, `/forget-password*`, `/request-password-reset`, `/reset-password*`,
`/sign-in/email-otp`, `/verify-email`, `/send-verification-email` answer `404` so the rules above
cannot be bypassed.

## Invite email

Creating, re-inviting, or changing the email of an invited employee now emails the invitee
`<WEB_ORIGIN first entry>/invite?token=...` (valid 7 days). It is sent only after the database transaction commits (a rolled-back create / re-invite / email change sends nothing), fire-and-forget; a failed send
is logged (kind + recipient) and never fails the request. `INVITE_RETURN_LINK` is unchanged (dev only).

## Production settings (lead)

| Variable                                    | Required                    | Notes                                                                               |
| ------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `RESEND_API_KEY`                            | yes (boot fails without it) | `re_...`; secret, set in the host's env only                                        |
| `MAIL_FROM`                                 | yes                         | `AriForce <no-reply@your-domain>`; the domain must be verified in Resend (SPF/DKIM) |
| `PASSWORD_RESET_RATE_PER_EMAIL` / `_PER_IP` | no                          | defaults 3 / 10 per hour                                                            |
| `WEB_ORIGIN`                                | yes (existing)              | first entry is used for invite links: must be the public web URL                    |

Behind the tunnel: `BETTER_AUTH_URL` must be the public https API origin (what the browser calls),
not the local port; `BETTER_AUTH_SECRET` at least 32 random characters, stable across restarts and
instances (rotating it signs everyone out); `WEB_ORIGIN` lists the exact https web origins (they
are better-auth's trusted origins and the CORS allow list). Keep `TRUST_PROXY` / `CLIENT_IP_MODE`
so per-IP limits see the real client IP. With web and API on different sites, cookies need
`SameSite=None; Secure`; prefer serving both under one registrable domain (e.g. `app.` and `api.`)
so cookies stay same-site, or use the bearer token flow.
