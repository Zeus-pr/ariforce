# Cutly lessons → AriForce audit

Source: "Cutly lessons learned" canvas (store-b035eb90…/9c29bdad…). Audited read-only on 27 Oct 2026 (IST) against main checkout `feat/signup-requests` @ ddcb66e.
Status: **Done** (evidence cited) · **Partly** · **Missing** · **N/A**. Infra/mobile Cutly items are partly from memory: treat as guidance. Cutly was online-only, so offline sync has no Cutly precedent.

## Lessons

| # | Lesson | Status | Evidence | Action |
|---|---|---|---|---|
| S1 | Never link accounts on unverified email / account takeover | Partly | `apps/api/src/auth/auth.ts`: no social providers, better-auth `disableSignUp: true`; sign-up goes through `POST /v1/auth/sign-up-request` → pending until approved (`docs/SIGNUP.md`); generic 409 `UNAVAILABLE` avoids enumeration | No email/phone verification at sign-up; approver must vet identity. Add verified email/phone OTP before approval; if Google sign-in is ever added, link only on `email_verified` |
| S2 | Don't trust X-Forwarded-For | Partly | `bootstrap.ts`: `trust proxy = TRUST_PROXY ?? 'loopback'`; limiter and audit use `req.ip` (`signup.controller.ts`, `session.guard.ts`) | Add one `getClientIp()` (CF-Connecting-IP only when request comes from a trusted proxy); set `TRUST_PROXY` correctly per host; bind/firewall API so only the proxy reaches it; test spoofed XFF |
| S3 | Admin off the public port | Partly | Admin/approvals are RBAC-guarded routes on the same API; `/docs` (Scalar) + `/openapi.json` public | Disable or gate `/docs` in prod; any future Metabase/admin behind Cloudflare Access |
| S4 | OTPs bound to purpose | N/A (now) | No OTP flow; email+password only | When phone OTP lands: purpose per code, single use, per-purpose cooldown |
| S5 | Short PINs need attempt limits | Partly | No PINs; password min length 8 (`auth.ts`); better-auth built-in limiter (in-memory) | Explicit sign-in rate limit per email+IP and lockout; crypto RNG for any future codes |
| S6 | Re-auth before destructive actions | Missing | No step-up auth on role changes, deletes, exports | Require fresh password for role/permission changes, exports, account deletion |
| S7 | Session revocation | Partly | DB sessions, 7-day expiry (`auth.ts`); revocation audited; guard re-resolves membership each request (`session.guard.ts`, `auth_account_status` checks `deleted_at`) | On suspend/delete/password/role change, delete all `auth_session` rows for the user; test that a suspended user's bearer token gets 403 |
| S8 | Atomic rate-limit counters | Missing | `signup.service.ts` `RateLimiter` is an in-memory Map, per instance | Shared store (Postgres/Redis/KV) + Cloudflare rate-limit rule on `/v1/auth/*` |
| S9 | Fail fast on missing secrets | Partly | `BETTER_AUTH_SECRET` fatal in production only; falls back to a dev secret otherwise; R2 missing → 503 at runtime | Zod env schema validated at startup; fatal in prod for DB, auth secret, R2, WEB_ORIGIN, TRUST_PROXY |
| S10 | Secrets out of git | Done | `.gitignore` excludes `.env*` (keeps `.env.example`); `git ls-files` shows no keystore/google-services/.env/.pem; push scan done before first push | Secret manager on host; enable GitHub secret scanning |
| S11 | Body size, Helmet, CORS, health | Partly | 1 MB JSON limit, explicit CORS allowlist `WEB_ORIGIN`, bare `/v1/health`, uploads via presigned R2 URLs (`storage.service.ts`) | Add Helmet (no Helmet found) |
| S12 | Constant-time signature checks | N/A | No webhooks/payments | Use `timingSafeEqual` if added |
| S13 | WebView origin allowlist | N/A (later) | Native app not started | Apply in app |
| S14 | Privacy text matches data (DPDP) | Partly | `consent_records`, `devices`, `geo_captures` tables (0004) | Field inventory with purpose/retention, privacy notice, grievance officer, deletion policy |
| S15 | PII in logs | Partly | Errors return generic 500 (`error.filter.ts`); audit stores raw IP/UA | Structured logger with redaction; consider hashing IPs in audit |
| S16 | Dependency risk | Partly | Lockfile + `--frozen-lockfile` in CI | Dependabot/Renovate + `pnpm audit` in CI |
| D1 | DB constraints for invariants | Partly | RLS, CHECKs/UNIQUEs in migrations; append-only audit trigger (0002) | Review per feature (e.g. one DCR per user/day, overlapping leave) |
| D2 | Race conditions in multi-step writes | Partly | Transactions via `withTenant`; idempotency in DCR/check-ins | Row locks/serializable for approvals, expense state changes, sample ledger; concurrency tests |
| D3 | Indexes and FKs | Partly | GiST on `territories.boundary`, `doctors.location` (0001); FKs in schema | Audit every FK/filter column has an index |
| D4 | One DB pool | Done | Single `createDb` + `DB_POOL_MAX`; `DIRECT_URL` vs `DATABASE_URL` split | — |
| D5 | Typed columns | Done | Drizzle timestamptz/date/jsonb/PostGIS | Keep IST handling in one helper |
| D6 | Document raw-SQL drift | Done | `db:sql:check` in CI; generated plain-SQL migrations | — |
| D7 | Codegen on start / migration diff | Done | CI `openapi:check`, `db:sql:check`, migrate run twice (idempotent) | — |
| D8 | Multi-tenancy + RLS tested with non-owner role | Done | `company_id` + `set_config` per transaction (`packages/db/src/client.ts`); `packages/db/test/rls.test.ts` runs as non-superuser `ariforce_app` (10 tests, cross-tenant) | Add RLS/IDOR tests per new table (expenses, leave) and per role (BM vs ABM vs other HQ) |
| A1 | Reads never mutate / write-time generation | Partly | Not audited exhaustively | Rule in CONTRIBUTING; review GET handlers |
| A2 | N+1 queries | Partly | KPI views (0009) | Measure p95 of masters/KPI lists with real data |
| A3 | State machine allowlists | Partly | Expense draft→submitted→approved→paid (`expenses.service.ts`), tour-plan approvals | Explicit transition table + "expected prior state" update, tests per transition |
| A4 | Status edge cases derived server-side | Partly | Server returns status | One status function per entity |
| A5 | Modular server | Done | NestJS modules per domain (`apps/api/src/*`) | — |
| A6 | Idempotency keys | Partly | DCR + check-ins + imports use idempotency (`dcr.service.ts:338`, `checkins.service.ts:171`) | Required on every offline write (expenses, orders, leave) |
| M1–M4 | Expo SDK pinning, keystores/Firebase, DOM components, real-phone checks | N/A (later) | Native app not started | Apply when starting app; real-device check for web on phones now |
| M5 | Offline-first sync (no Cutly precedent) | Missing | Only idempotency keys exist | Design doc: PowerSync (or similar), server-wins, client UUIDs, lock on submit, conflict log to audit |
| W1 | WebGL headless | N/A | — | — |
| W2 | Browser cache after deploys | Missing | Not deployed | Cache bypass on API host, `no-store` on user data |
| W3 | Deploy traceability (deploy from CI only) | Missing | CI exists, no deploy pipeline | Deploy only from CI on a tagged commit |
| I1 | API not on a laptop; managed India hosting | Missing | API/web run on the Mac (:4000/:3200); DB is Supabase Mumbai | Host API in Mumbai region (Render/Railway/AWS ap-south-1); staging + prod |
| I2 | Cloudflare zone hardening | Partly | Subdomains + R2 CORS created | Verify Full (Strict), TLS ≥1.2, HSTS, CAA, SPF/DMARC |
| I3 | Separate mail subdomain | Missing | No email service | Send from a mail subdomain |
| I4 | Staging + admin behind Access | Missing | No staging Supabase project | Separate staging project |
| I5 | Rollback / backups | Missing | Supabase backups/PITR not confirmed | Enable paid backups + PITR; backward-compatible migrations; rollback runbook |
| T1 | Attack the running system | Missing | Integration tests only | Security retest on throwaway stack before go-live (XFF, IDOR, sign-up abuse) |
| T2 | State SHA tested | Partly | Agent reports cite SHAs | Keep |
| T3 | Flaky concurrency tests | Partly | `field.test.ts` order-dependent flake fixed in 6527e5e | Keep deterministic |
| T4 | CI from day one | Done | `.github/workflows/ci.yml`: format, lint, typecheck, OpenAPI/SQL drift, migrate×2, seed, tests incl. RLS on PostGIS 17, build | Make CI required on `main`; add `pnpm audit` |
| P1–P5 | Review flow, local-only rule, merge order, board hygiene, acceptance criteria | Partly | Local-only + approval rule in use; board cleaned 27 Oct | Track PR dependencies; "done = retested" |

## Day-one checklist (19)

| # | Item | Status |
|---|---|---|
| 1 | Cloud hosting (Mumbai), staging + prod, nothing on a laptop | Missing |
| 2 | company_id + RLS per request + cross-tenant test | Done |
| 3 | Role hierarchy server-side + IDOR tests | Partly (`canDecide`, RBAC tests; extend IDOR to DCR/expense IDs) |
| 4 | Verified OTP, purpose-bound, attempt caps, device binding, short tokens | Missing (password only; device table exists) |
| 5 | Client IP from CF-Connecting-IP via trusted proxy; shared rate limits + CF rule | Partly |
| 6 | Admin/Metabase behind Cloudflare Access | Partly (/docs public) |
| 7 | Offline sync: server wins, idempotency, lock on submit, conflict audit | Partly (idempotency only) |
| 8 | Write-time generation; reads never mutate | Partly |
| 9 | PostGIS + GiST, server geofence, FK indexes | Partly (GiST done) |
| 10 | Android GPS rules | N/A (later) |
| 11 | Append-only, hash-chained audit log | Partly (append-only trigger; no hash chain) |
| 12 | Locks on ledgers/targets + concurrency tests | Partly |
| 13 | Env validated at startup; secret manager; no keystores in git | Partly |
| 14 | Expo dev builds, pinned SDK | N/A (later) |
| 15 | Signed uploads, small body limit, Helmet, CORS, bare health | Partly (Helmet missing) |
| 16 | Cloudflare zone hardening, mail subdomain | Partly |
| 17 | DPDP inventory, notices, grievance officer, log redaction | Missing |
| 18 | CI day one; deploy only from CI; rollback | Partly (CI done) |
| 19 | Review flow + security retest on live stack | Partly |

## Phase 0: must do before going live (ranked)

1. Host API in a managed India region (staging + prod); stop serving from the Mac. Enable Supabase backups + PITR and a separate staging project.
2. Client IP: one `getClientIp()` trusting CF-Connecting-IP only from the proxy; correct `TRUST_PROXY`; test XFF spoofing.
3. Shared, atomic rate limits (sign-in, sign-up, sign-up-options) + Cloudflare rule on `/v1/auth/*`; sign-in lockout.
4. Sign-up hardening: verified email/phone before approval, Turnstile on (`TURNSTILE_SECRET`), approver checklist.
5. Session revocation on suspend/delete/role or password change, with a test.
6. Startup env validation (fatal in prod), secrets only in host secret manager, rotate R2 to a bucket-scoped token.
7. Helmet; hide `/docs` + `/openapi.json` in prod; Cloudflare zone Strict/TLS1.2/HSTS.
8. DPDP: privacy notice matching collected fields (GPS, devices), retention/deletion policy, grievance officer, log redaction.
9. Step-up re-auth for role changes and exports; IDOR/RLS tests for expenses, leave, DCR per role.
10. Deploy only from CI with a rollback runbook; CI required on `main`; Dependabot + `pnpm audit`.
11. Before the field app: offline sync design doc (server-wins, client UUID + idempotency on every write, lock on submit, conflict audit).
