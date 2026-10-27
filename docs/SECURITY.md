# Security

Hardening from the Cutly audit (`docs/CUTLY-LESSONS-CHECKLIST.md`). One section per issue.

## Session revocation (#79)

- Sessions are better-auth DB rows (`auth_session`); cookies and bearer tokens both resolve to them.
- `PATCH /v1/employees/{id}` deletes **all** sessions of the user, in the same transaction, when:
  - the status changes to a non-active value (`suspended` = deactivate; `invited`), or
  - the role changes.
    Other edits (name, phone, territories, manager) keep sessions. Each revocation writes
    `auth.sessions_revoked` (`after: { reason, sessions }`) plus one `auth.session_revoked` per session.
- The next request with an old cookie or token gets **401** (`Sign in required`).
- Suspended users cannot sign in: `POST /v1/auth/sign-in/email` → **403 `ACCOUNT_SUSPENDED`**, no
  session is created (same hook as `ACCOUNT_PENDING_APPROVAL` / `ACCOUNT_REJECTED`). Reactivating
  (`status: active`) allows sign-in again.
- Passwords: `admin:create-first --reset-password` deletes the identity's sessions;
  better-auth `revokeSessionsOnPasswordReset` is on for when an email reset flow is enabled
  (none today).
- Helper: `apps/api/src/auth/revoke.ts` (`revokeUserSessions`). No migration: `ariforce_app`
  already has DELETE on `auth_session` (0005).
- Test: `apps/api/test/session-revocation.test.ts`.

## Environment validation (#80)

- `apps/api/src/env.ts` (`ProdEnv` zod schema, `validateEnv`) runs first in `main.ts`. Only when
  `NODE_ENV=production`; any problem stops boot with `Invalid production environment:` and one
  `NAME: reason` line per variable. Values are never printed. Empty values count as missing.
- Required in production: `DATABASE_URL` (postgres://), `BETTER_AUTH_SECRET` (min 32 chars),
  `BETTER_AUTH_URL` (https), `WEB_ORIGIN` (comma-separated https origins, no paths/wildcards),
  `TRUST_PROXY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
- Optional, checked if set: `R2_ENDPOINT`, `R2_PUBLIC_URL` (https), `PORT`, `DB_POOL_MAX`,
  `SIGNUP_RATE_PER_IP`, `SIGNUP_RATE_PER_EMAIL` (integers), `EXPENSE_APPROVAL_LEVELS` (1|2);
  `INVITE_RETURN_LINK=true` is refused in production.
- Dev/test: unchanged defaults (dev auth secret, localhost origins, R2 optional → 503 on upload).
- Test: `apps/api/test/env.test.ts`.
