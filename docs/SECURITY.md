# Security

Hardening from the Cutly audit. One section per issue.

## Session lifetime

- One `auth_session` row per sign-in; the browser cookie and the mobile bearer token
  (`Authorization: Bearer`, better-auth `bearer()` plugin) are the same row, so the same rules apply.
- **Hard cap 18 h from sign-in, no sliding**: `expiresIn` = `updateAge` = `SESSION_MAX_AGE_SECONDS`
  (default `64800`, allowed 300..2592000). Activity never extends a session.
- Tradeoff: a user who is active all day must sign in again 18 h after signing in. The sliding
  alternative is a small `updateAge` (e.g. 1 h), which gives an 18 h _idle_ window instead, but then an
  active (or stolen) session never expires on its own.
- Expired session -> better-auth returns no session -> `401` on `/v1/me` and every data route (tested in
  `apps/api/test/session-lifetime.test.ts`; runs in CI against the workflow Postgres service, skipped
  locally without `DIRECT_URL`/`DATABASE_URL`).
- Existing sessions from before the cap: one-off `packages/db/scripts/data-fixes/2026-11-03-session-18h-cap.sql`
  (lead, after deploy) caps them; signs out anyone signed in more than 18 h ago.
- No `cookieCache`: revocation (deactivate, password reset, role change) is immediate.
- Cookie: `HttpOnly`, `Path=/`, `Max-Age` = the cap, `Secure` (and the `__Secure-` name prefix) when
  `BETTER_AUTH_URL` is https.
  - `AUTH_COOKIE_SAMESITE` (`lax` default, `strict`, `none`; `none` forces `Secure`).
  - `AUTH_COOKIE_DOMAIN` (optional bare parent domain, e.g. `x.com`) shares the cookie across subdomains.
  - Set `AUTH_COOKIE_DOMAIN` from day one. Setting it later leaves two cookies with the same name
    (host-only and `Domain=`) in browsers until the old one expires; which one is sent is undefined.
  - `AUTH_COOKIE_SAMESITE=strict` drops the cookie on any cross-site request, including top-level
    navigation from links in other sites, mail or chat: the user lands signed out. Prefer `lax`.
  - Recommended: custom domains on one site (`app.x.com` + `api.x.com`), `AUTH_COOKIE_SAMESITE=lax`,
    `AUTH_COOKIE_DOMAIN=x.com`.
  - Two `*.up.railway.app` hosts are different sites (public suffix): only `AUTH_COOKIE_SAMESITE=none`
    works there, and Safari (ITP) may still drop the third-party cookie.
- `WEB_ORIGIN` (CORS + better-auth `trustedOrigins`) must list the exact deployed web origin (scheme +
  host, no trailing slash); CORS already sends credentials.
- Login OTP (`LOGIN_OTP`): the code lives 5 min, the pending two-factor cookie 10 min; the session it
  creates then follows the rules above.
- Changing `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL` signs everyone out (cookie signature / name).
- Known item: natural expiry is not audited (better-auth expires the row itself; no
  `auth.session_revoked` row). No session cleanup job: expired rows stay in `auth_session` (harmless).

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

## Client IP and rate limits (#77)

- `apps/api/src/common/client-ip.ts` `clientIp(req)`: with `CLIENT_IP_MODE=cloudflare` use
  `CF-Connecting-IP`; with `CLIENT_IP_MODE=railway` use `X-Real-IP`; otherwise use the TCP peer.
  A missing or invalid forwarded IP falls back to the TCP peer. `X-Forwarded-For` is never
  read. A middleware writes the result to the internal header `x-ariforce-client-ip` (client
  values overwritten), which is the only header better-auth reads for its IP (sessions, its own
  limiter). Audit rows and sign-up use the same IP.
- `apps/api/src/common/rate-limit.ts`: `RateLimitStore` interface (fixed window,
  `hit(key, limit, windowMs) → { allowed, retryAfter }`), `MemoryRateLimitStore` (default) and
  `setRateLimitStore()` to plug in Redis/Upstash/Postgres later. **The in-memory store is
  single-instance only**: with several API instances each has its own counters, so rely on the
  Cloudflare rules below until a shared store is wired.
- Limits per client IP (env overrides):

  | Endpoint                              | Default                                                           |
  | ------------------------------------- | ----------------------------------------------------------------- |
  | `POST /v1/auth/sign-in/*`             | `AUTH_RATE_PER_IP` = 20 / 15 min                                  |
  | other `POST /v1/auth/*` (better-auth) | 3 × `AUTH_RATE_PER_IP` / 15 min                                   |
  | `POST /v1/auth/sign-up-request`       | `SIGNUP_RATE_PER_IP` = 10 / h and `SIGNUP_RATE_PER_EMAIL` = 3 / h |
  | `GET /v1/auth/sign-up-options`        | 6 × `SIGNUP_RATE_PER_IP` / h                                      |
  | `POST /v1/invites/accept`             | `INVITE_RATE_PER_IP` = 10 / h                                     |

- Over the limit: **429** `{ error: { code: "RATE_LIMITED", message, details: { retryAfterSeconds } } }`
  plus a `Retry-After` header (seconds). better-auth's own built-in limiter stays on as well.
- Tests: `apps/api/test/client-ip-ratelimit.test.ts` (XFF spoofing, CF mode, 429 shape).

Railway mode is safe only when public traffic passes through Railway's HTTP edge, no raw TCP
proxy exposes the API, and all services able to reach it over private networking are trusted.
The edge overwrites `X-Real-IP` and uses Cloudflare's client IP for requests from its trusted
Cloudflare IPv4 ranges. Private-network requests bypass this sanitization. See
[Railway's proxy trust guidance](https://station.railway.com/questions/secure-express-proxy-trust-forwarded-he-aa788da4).

### Cloudflare rules to add at deploy (lead)

1. DNS for the API hostname **proxied** (orange cloud) or a Cloudflare Tunnel; firewall the origin so
   only Cloudflare (IP ranges or the tunnel) can reach it; then set `CLIENT_IP_MODE=cloudflare`.
2. Rate limiting rules: `/v1/auth/sign-in*` e.g. 10 req / 1 min per IP → block 10 min;
   `/v1/auth/*` 30 / 1 min per IP; `/v1/auth/sign-up-request` and `/v1/invites/accept` 5 / 10 min.
3. WAF managed rules: Cloudflare Managed Ruleset + OWASP Core Ruleset on (log first, then block).
4. Bot Fight Mode (or Super Bot Fight Mode: block definitely automated on `/v1/auth/*`).
5. Cache rule: **bypass cache** for `api.<domain>/v1/*` (authenticated JSON must never be cached).
6. SSL/TLS Full (strict), minimum TLS 1.2, Always Use HTTPS, HSTS.
7. Optional: Turnstile on sign-up (`TURNSTILE_SECRET`), Cloudflare Access in front of any admin tools.

## HTTP security headers and API docs (#81)

- Helmet is applied to every response: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-site`, COOP; `X-Powered-By` is removed.
- `Strict-Transport-Security` (1 year, includeSubDomains) is sent only when `NODE_ENV=production`.
- `/docs` (Scalar reference) and `/openapi.json` return 404 in production. In dev they are served; `/docs` skips CSP because the reference UI loads from a CDN.
- The spec is generated from `packages/contracts` (`pnpm -F @ariforce/contracts openapi` / `openapi:check`), which never needs the HTTP route.
- CORS is unchanged and strict: only origins listed in `WEB_ORIGIN` are reflected, with credentials; other origins get no `Access-Control-Allow-Origin`.
- CORS exposes `Retry-After` (so the web app can back off on 429) and `Content-Disposition` (export file names) via `Access-Control-Expose-Headers`; other origins still get no `Access-Control-Allow-Origin`, so they can read nothing.
