---
status: accepted (pending sign-off by Prajesh Choudhury)
date: 2026-10-26
deciders: AriForce Architect, AriForce lead
---

# 0001: Stack for AriForce web + API (Phase 0)

## Context and problem statement

AriForce is a multi-tenant pharma field-force automation (SFA) platform: manager/admin website first, native
Android field app later on the **same API**. Field reps work in low-connectivity areas, so the API must
support offline sync. Data includes personal data of employees and doctors (DPDP Act 2023), so it must stay
in India by default. Several companies (tenants) share one deployment. The plan proposed a stack; this ADR
confirms or adjusts it.

## Decision drivers

- One typed contract shared by web, API and Android (no drift).
- Hard tenant isolation that survives application bugs.
- Hierarchical access (Rep -> Area -> Region -> Zone -> National) and geo queries (GPS attendance, doctor locations).
- Offline-first Android client: delta sync, tombstones, conflict detection, idempotent writes.
- India data residency; small team; well-maintained libraries over custom code.

## Decision

| Concern          | Choice                                                                                                                                                                    | Verdict vs plan                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Monorepo         | pnpm workspaces + Turborepo                                                                                                                                               | Confirmed                                                                                                                 |
| API              | NestJS (Express adapter), REST `/v1`, zod contracts in `packages/contracts`, OpenAPI 3.1 generated from zod                                                               | Confirmed; **added**: contracts are zod-first (not Nest decorators) so the Android team can codegen from the same OpenAPI |
| ORM / migrations | Drizzle ORM + drizzle-kit; hand-written SQL migrations for RLS, triggers, grants                                                                                          | Confirmed                                                                                                                 |
| Database         | **Supabase Postgres, Mumbai `ap-south-1`** (project `ariforce`), PostGIS + pgcrypto in schema `extensions`; local/CI on PostGIS 17-3.5 with the same migrations           | Decided                                                                                                                   |
| Tenancy          | `company_id NOT NULL` on every tenant table + Postgres RLS keyed on `current_setting('app.current_company_id')`, app connects as a non-superuser role without `BYPASSRLS` | Confirmed                                                                                                                 |
| Auth             | better-auth (email+password, DB sessions, bearer plugin for Android, phone OTP plugin later)                                                                              | Confirmed                                                                                                                 |
| Authorization    | Own RBAC: roles + permissions in DB, hierarchy scoping via territory materialised path, Nest guards                                                                       | Confirmed                                                                                                                 |
| Web              | Next.js (App Router) + Tailwind v4 + shadcn/ui; typed client + MSW mocks from contracts                                                                                   | Confirmed                                                                                                                 |
| Files            | **Cloudflare R2** (S3 API) with short-lived presigned upload/download URLs; never D1                                                                                      | Decided                                                                                                                   |
| IDs              | UUIDv7 (time-ordered; client-generatable offline)                                                                                                                         | Added                                                                                                                     |
| Audit            | Append-only `audit_log` table (no UPDATE/DELETE grants + blocking trigger)                                                                                                | Added                                                                                                                     |

## Considered options

### API framework

- **NestJS (chosen)**: structure (modules, guards, interceptors) fits RBAC + request-scoped tenancy; large hiring pool.
- Fastify/Hono + plain modules: lighter and faster, but we would rebuild DI, guards and testing conventions. Revisit only if latency becomes a problem (Nest can switch to the Fastify adapter).
- tRPC: great for web-only, but the Android (Kotlin) client needs plain REST/OpenAPI.

### ORM

- **Drizzle (chosen)**: SQL-first, typed, supports PostGIS `geometry`, RLS-friendly (we control the connection and `SET LOCAL`), no engine binary.
- Prisma: mature, but RLS needs per-request transactions via extensions, PostGIS is mostly `Unsupported`, and the engine binary/cache complicates the SSD-only rule.
- Kysely: excellent query builder, but no schema/migration story of its own.

### Tenant isolation

- **Shared schema + `company_id` + RLS (chosen)**: one migration path, cheap tenants, DB-enforced isolation.
- Schema-per-tenant: stronger blast-radius isolation, but N-times migrations and painful cross-tenant ops.
- DB-per-tenant: reserve for a large customer that contractually needs it; RLS design does not block this later.

### Auth

- **better-auth (chosen)**: open source, self-hosted (data stays in our India DB), Drizzle adapter, sessions, bearer and phone-number/OTP plugins.
- Auth.js: web-centric, weaker story for a native Android client.
- Clerk / Auth0 / Firebase Auth: fast, but identity data leaves India by default and adds per-MAU cost; harder DPDP story.
- Keycloak: powerful but heavy to run for a small team.
- better-auth's own `organization`/`access` plugins were **not** adopted for RBAC: our access is territory-hierarchy based, which is easier to express (and enforce in SQL) with our own tables.

### Supabase Auth vs better-auth

Supabase is used **only as managed Postgres**. Supabase Auth is **off**; we keep better-auth + own RBAC because:

- Our authorization is territory-hierarchy + company scoped and enforced by RLS keyed on `app.current_company_id` set per transaction. Supabase Auth's model (JWT claims + `auth.uid()` policies via PostgREST) would push us to the Data API or to re-verify JWTs in Nest anyway.
- The API connects as a dedicated non-bypass role through the transaction pooler; Supabase Auth expects `anon`/`authenticated` roles and PostgREST, which we lock down instead.
- Portability: the auth tables live in our schema and migrations, so leaving Supabase (or self-hosting in India) is a `pg_dump`, not an identity migration.
- Android: better-auth bearer sessions are revocable server-side; phone OTP plugin is available for field reps.
- Cost: Supabase Auth is free at our scale, so this is not a cost decision. Revisit if we ever adopt the Data API/Realtime directly from clients.

### Hosting: Supabase + R2 notes

- **Connections:** API uses `DATABASE_URL` = Supavisor **transaction pooler** (port 6543, user `ariforce_app.<project-ref>`), every request inside `withTenant()` = one transaction with `set_config('app.current_company_id', $1, true)`; no session state, no `SET`, prepared statements not relied on. Migrations use `DIRECT_URL` (owner, direct/session connection).
- **Roles:** `ariforce_app` is created by migration SQL: `NOSUPERUSER NOBYPASSRLS`, no password in git (set once in the Supabase SQL editor). Never `postgres`/`service_role` for requests.
- **RLS:** `ENABLE` + `FORCE` on every tenant table; policies are `TO ariforce_app` only.
- **API lockdown:** we do not use PostgREST. Migration 0003 revokes all table/sequence/function privileges and default privileges from `anon` and `authenticated`, which also have no policies. Supabase's Data API can additionally be disabled in project settings.
- **Migrations:** plain, ordered, idempotent SQL in `packages/db/migrations/` (generated from Drizzle), applied by `db:migrate` or by hand / Supabase connector.
- **R2 residency caveat:** R2 has no India jurisdiction; use location hint APAC and store only documents we may hold outside India, or move to an India S3-compatible bucket later (the storage module is S3-API, so it is a config change).

### Web

- **Next.js + Tailwind + shadcn/ui (chosen)**: matches the brief (free UI collections), App Router for portal pages.
- Vite SPA (React Router): simpler hosting, but loses SSR/route conventions the team already uses in CUTLY.

## Borrowed from CUTLY (read-only reference, `/Volumes/Prajesh_ext_512/CUTLY` and siblings)

| From CUTLY                                                                                                                                                 | Used in AriForce as                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Money as integer paise (`backend/src/money.ts`, `pricePaise`)                                                                                              | All amounts (TA/DA, samples value, POB) are `*_paise` integers                                    |
| IST day helpers (`backend/src/ist.ts`)                                                                                                                     | Business days (DCR day, attendance, cycle) computed in `Asia/Kolkata`, stored as UTC              |
| `toClientError` / `httpError.ts`: stable `code`, no ORM/secret leaks                                                                                       | Global Nest exception filter -> `{ error: { code, message } }` (docs/API-CONVENTIONS.md)          |
| Zod validation at every route edge                                                                                                                         | zod contracts in `packages/contracts`, reused by API + web                                        |
| Rate limits: Redis `INCR` with in-memory fallback, `RATE_LIMITED` + `Retry-After`, client IP only from trusted proxy CIDRs (`rateLimit.ts`, `clientIp.ts`) | Same design for login/OTP and write endpoints (Phase 1)                                           |
| Soft delete with grace + purge job (`accountDeletion.ts`, `accountPurge.ts`)                                                                               | `deleted_at` tombstones + retention purge jobs (DPDP, #36)                                        |
| Admin surface isolated (loopback listener, strong secret)                                                                                                  | Admin role in RBAC; ops-only endpoints never public                                               |
| Knowledge docs kept current (ARCHITECTURE.md, RULES.md, MEMORY.md, PRD.md)                                                                                 | `docs/` (ADR, DATA-MODEL, RBAC, API-CONVENTIONS, WEB-LAYOUT) updated in the same PR as the change |
| Env discipline: secrets only in git-ignored `.env`, `.env.example` names only                                                                              | Same; R2 + DB URLs + `BETTER_AUTH_SECRET`                                                         |
| Monorepo-adjacent split (app / backend / admin / site)                                                                                                     | `apps/web`, `apps/api`, later `apps/android` on one API                                           |

Not borrowed, with reasons: CUTLY's hand-rolled JWT auth (we use better-auth sessions, revocable, bearer for Android), Prisma (see ORM above), Express without modules (Nest gives guards/DI for RBAC + tenancy), Neon us-east-2 (India residency).

## Consequences

Good:

- Tenant leaks need _both_ an app bug and an RLS bug. Integration tests run as the non-superuser app role.
- One zod contract -> OpenAPI -> typed web client, MSW mocks and (later) Kotlin codegen.
- UUIDv7 + `updated_at` + `version` + `deleted_at` give Android delta sync, conflict detection and tombstones from day one.

Bad / risks:

- Every request runs in a transaction that does `SET LOCAL app.current_company_id`; connection poolers must be in **transaction mode** (Supavisor 6543) and code must never use the pool outside `withTenant()`.
- RLS adds query-planner overhead; keep `company_id` as the leading column of hot indexes.
- better-auth is younger than Auth.js/Keycloak; pin versions and keep the auth module thin so it can be swapped.
- Drizzle-kit does not generate RLS/trigger SQL; those live in reviewed custom migrations.

## India data residency

- Primary DB, backups, object storage and logs in an Indian region; no third-party identity provider.
- Personal data processors (email/SMS/OTP providers, error tracking) must offer India hosting or be configured to strip PII. Compliance details (DPDP notices, consent, retention, UCPMP) are tracked in #13 and need counsel review.

## Offline sync (Android, #12)

- Pull: `GET /v1/<resource>?updatedSince=<serverTime>` including tombstones.
- Push: client-generated UUIDv7 ids, `Idempotency-Key` on POST, `version` on PATCH (409 on conflict; server wins, client re-applies).
- Field writes (DCR, attendance) are append-mostly, which keeps conflicts rare.

## Revisit when

- More than ~200 tenants or one tenant > 10k users (consider partitioning by `company_id`).
- A customer requires dedicated infrastructure (DB-per-tenant).
