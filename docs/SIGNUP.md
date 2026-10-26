# Sign-up flow: contract for the web sign-in page (Dev)

The API, contracts and mocks are done. The UI is not built yet; Dev owns it.

## 1. Request an account

`POST /v1/auth/sign-up-request` is public; no session is needed. Types: `SignupRequestCreate` and `SignupRequestAccepted` from `@ariforce/contracts`.

```json
{
  "name": "...",
  "email": "...",
  "phone": null,
  "password": "min 12 chars",
  "requestedRole": "business_manager",
  "territoryId": null,
  "managerId": null,
  "turnstileToken": "optional"
}
```

- `requestedRole` can be any role key except `system_admin` (see `SIGNUP_ROLE_KEYS`).
- 202 `{ "status": "pending", "message": "..." }`: show "Request sent, you can sign in after approval".
- 409 `SIGNUP_UNAVAILABLE`: show the message as is. It is generic on purpose, so don't say "email exists".
- 422: validation. 429 `RATE_LIMITED`. 403 `CAPTCHA_FAILED`. 503 `SIGNUP_DISABLED`.
- Turnstile: render the widget and send `turnstileToken`. The server enforces it only when `TURNSTILE_SECRET` is set.

## 2. Signing in before approval

`POST /v1/auth/sign-in/email` uses better-auth's body shape, without the `error` wrapper:

- 403 `{ "code": "ACCOUNT_PENDING_APPROVAL", "message": "..." }`: show "Your account is awaiting approval".
- 403 `{ "code": "ACCOUNT_REJECTED", "message": "..." }`: show "Your request was not approved, contact your administrator".
- 401 `INVALID_EMAIL_OR_PASSWORD`: unchanged.

A token that already exists for such a user gets 403 `{ "error": { "code": "ACCOUNT_PENDING_APPROVAL" | "ACCOUNT_REJECTED" } }` on every `/v1/*` data call. Treat that as signed out and show the same message.

## 3. Approval screen (system admin, ABM and above)

- `GET /v1/signup-requests?status=pending|approved|rejected` (default `pending`) returns `{ items: SignupRequest[] }`.
- `POST /v1/signup-requests/{id}/approve` with `{ role, territoryIds?, managerId? }` returns 200 `SignupRequest`.
  - 403: role or territory is outside your authority, or it is your own request.
  - 404: not visible. 409: already decided. 422: e.g. no territory, or a manager given for a director.
- `POST /v1/signup-requests/{id}/reject` with `{ reason? }` returns 200 `SignupRequest`.
- Use `assignableRoles(rank)` for the role picker. Only a system admin may grant functional roles (`distribution_head`, `accountant`).

## Mocks

`createHandlers()` covers all of the above. A request stays in memory. Signing in with its email returns the pending or rejected code; after approval it returns a `mock:<role>` token. Simplification: the mock lets an ABM+ see every request for a role below theirs and does not check territory.

## Notes

The rate limiter keeps its counts in memory, so the limits hold per API instance. Use a shared store before running more than one instance.
