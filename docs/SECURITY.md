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
