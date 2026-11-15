# Run AriForce locally

Run everything from an SSD checkout or worktree under `/Volumes/Prajesh_ext_512/`. Start every shell
with:

```sh
source scripts/env.sh        # keeps pnpm/npm/turbo/node caches, tools and TMPDIR on the SSD
```

Secrets live only in the git-ignored env files `apps/api/.env` and `packages/db/.env`. The variable
names are listed in `.env.example` and in the table below. Never paste values into chat, git or logs.

## 1. Migrations

`packages/db/migrations/*.sql` are plain SQL files, applied in filename order. Every file is
idempotent, so applying the full set again is safe. They are exported from Drizzle with
`pnpm -F @ariforce/db db:sql`; hand-written files are noted in `docs/DATA-MODEL.md`.

| File                                 | Purpose                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `0000_extensions.sql`                | `extensions` schema with PostGIS and pgcrypto                                                                         |
| `0001_init.sql`                      | Core generated schema: companies, users, territories, masters, approvals, audit                                       |
| `0002_security.sql`                  | `ariforce_app` role, grants, RLS by `app.current_company_id`, row-meta triggers, append-only audit                    |
| `0003_supabase_hardening.sql`        | Revokes `anon`/`authenticated` (Supabase Data API) from the app schema                                                |
| `0004_devices_consent_geo.sql`       | `devices`, `consent_records`, `geo_captures` (append-only)                                                            |
| `0005_auth.sql`                      | better-auth tables (`auth_user`, `auth_session`, `auth_account`, `auth_verification`) and `auth_resolve_membership()` |
| `0006_role_hierarchy.sql`            | 8-level role hierarchy plus `system_admin`; enum renames                                                              |
| `0007_import_products.sql`           | `divisions`, `products`, `product_hq_mappings`, `import_jobs`/`import_rows`                                           |
| `0008_field_activity_sales.sql`      | `dcrs`, `dcr_calls`, `dcr_call_products`, tour plan visits, sales actuals                                             |
| `0009_kpi_views.sql`                 | `kpi_*` views (`security_invoker`)                                                                                    |
| `0010_company_lookup.sql`            | `company_id_by_slug()` used by `admin:create-first`                                                                   |
| `0011_field_settings.sql`            | Company geofence settings; `geo_captures` selfie and territory columns                                                |
| `0012_tour_plan_days.sql`            | `tour_plans.days`, `decision_comment`, `standard_tour_plans`                                                          |
| `0013_dcr_detail.sql`                | `joint_work_user_ids`, `dcrs.territory_ids`, `dcrs.tour_plan_id`                                                      |
| `0014_functional_roles_enum.sql`     | Adds `distribution_head` and `accountant` enum values                                                                 |
| `0015_functional_roles_rows.sql`     | Role rows for those two roles                                                                                         |
| `0016_employees_invites.sql`         | `user_invites`, `invite_resolve()`, territory city/state, `users.designation`                                         |
| `0017_users_joined_on.sql`           | `users.joined_on` (`IF NOT EXISTS`; it was hand-applied on the real DB earlier as "0010a")                            |
| `0018_masters_write_rbm_up.sql`      | Masters write for RBM and above; BM/ABM read-only                                                                     |
| `0019_role_permissions_baseline.sql` | Baseline `role_permissions` for every role (generated; `db:role-perms`)                                               |
| `0020_signup_requests.sql`           | `signup_requests` and `auth_account_status()`                                                                         |
| `0021_expense_claims.sql`            | `expense_claims`, `expense_lines`, `expense_attachments`                                                              |
| `0022_role_permissions_expenses.sql` | Expense and finance permissions                                                                                       |
| `0023_leave.sql`                     | `leave_settings`, `leave_policies`, `leave_requests`, `leave_grants`                                                  |
| `0024_kpi_leave_views.sql`           | `kpi_user_leave_day` view                                                                                             |
| `0025_role_permissions_leave.sql`    | Leave permissions                                                                                                     |
| `0026_work_types_defaults.sql`       | 8 standard work types per company; `companies_without_work_types()` (health warning)                                  |
| `0027_invite_status.sql`             | `invite_status()` behind `INVITE_INVALID` / `INVITE_USED` / `INVITE_EXPIRED`                                          |
| `0028_notifications_jobs.sql`        | `notifications`, `jobs`, `jobs_*` runner functions                                                                    |
| `0029_dcr_call_rcpa.sql`             | `dcr_call_rcpa` (RCPA lines on chemist calls)                                                                         |
| `0030_jobs_functions_hardening.sql`  | Hardens the `SECURITY DEFINER` `jobs_*` functions (runner-only assertion)                                             |
| `0031_exceptions.sql`                | `exception_rules`, `exceptions`, `exceptions_enqueue_daily()`; job allow-list extended                                |
| `0032_product_price_history.sql`     | `product_price_history` (append-only)                                                                                 |
| `0033_role_permissions_prices.sql`   | `products:prices` permission (System Admin)                                                                           |
| `0034_tada_allowances.sql`           | `allowance_rates`, `allowance_places`, `expense_lines` allowance columns, category `allowance`                        |
| `0035_doctor_duplicate_idx.sql`      | Two doctor lookup indexes for duplicate detection; no data change                                                     |

Leave backdating: the SQL column default in `0023` is 7 days, but the effective default is 14. The API
creates missing settings rows with 14 (`LEAVE_DEFAULT_BACKDATE_DAYS`), and the live company's row is
set to 14. No migration changes this (`docs/LEAVE.md`).

How they are applied:

- **Production (Supabase):** the lead applies migrations through the Supabase connector, one file
  at a time, in order. Applied status is tracked in `docs/README.md`.
- **Local, against a database you own:** `DIRECT_URL` (owner connection) set in `packages/db/.env`,
  then `pnpm -F @ariforce/db db:migrate`. It runs `packages/db/scripts/migrate.ts`, which applies
  every file in order and prints `applied <file>` for each one (it prints this even when the file
  changed nothing). With `CI` or `NODE_ENV=development` set, or `APP_DB_PASSWORD` given, it also
  gives `ariforce_app` a login. In Supabase that password is set by hand (`docs/SETUP.md`).
- Checks: `pnpm -F @ariforce/db db:sql:check` (the exported SQL matches the schema) and
  `pnpm -F @ariforce/db db:role-perms:check` (`0019` matches `DEFAULT_ROLE_PERMISSIONS`).

`DATABASE_URL` on Supabase must use the **transaction pooler** host
`aws-0-ap-south-1.pooler.supabase.com:6543` with user `ariforce_app.<project-ref>`. The `aws-1-…`
host returns "tenant/user not found". The API never uses prepared statements and sets
`app.current_company_id` with `set_config(..., true)` inside each request transaction.

## 2. Environment variables

Names and purpose only. Source: `apps/api/src/config/env.ts` (validated at boot only when
`NODE_ENV=production`; the process exits listing the bad variable **names**, never values) and
`.env.example`. "Prod" = required in production.

| Variable                         | Prod | Purpose                                                                                                                    |
| -------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | yes  | API connection as `ariforce_app` (postgres URL; Supabase transaction pooler)                                               |
| `BETTER_AUTH_SECRET`             | yes  | better-auth signing secret, at least 32 characters                                                                         |
| `BETTER_AUTH_URL`                | yes  | Public API base URL; https in production (`http://localhost:4000` locally)                                                 |
| `WEB_ORIGIN`                     | yes  | Comma-separated web origins for CORS and auth; https in production (default `http://localhost:3000,http://localhost:3200`) |
| `SESSION_MAX_AGE_SECONDS`        | no   | Web session / cookie Max-Age from sign-in, no sliding (default `64800` = 18 h)                                             |
| `MOBILE_SESSION_MAX_AGE_SECONDS` | no   | Mobile bearer session hard cap (default `7776000` = 90 days); web stays on `SESSION_MAX_AGE_SECONDS`                       |
| `AUTH_COOKIE_SAMESITE`           | no   | `lax` (default), `strict` or `none` (`none` forces Secure; needed for two `*.up.railway.app` hosts)                        |
| `AUTH_COOKIE_DOMAIN`             | no   | Bare parent domain to share the auth cookie (e.g. `x.com` for `app.x.com` + `api.x.com`)                                   |
| `TRUST_PROXY`                    | yes  | Express `trust proxy` setting (default `loopback`)                                                                         |
| `R2_ACCOUNT_ID`                  | yes  | Cloudflare R2 account for presigned uploads (`docs/STORAGE.md`)                                                            |
| `R2_ACCESS_KEY_ID`               | yes  | R2 access key id                                                                                                           |
| `R2_SECRET_ACCESS_KEY`           | yes  | R2 secret key                                                                                                              |
| `R2_BUCKET`                      | yes  | R2 bucket name                                                                                                             |
| `R2_ENDPOINT`                    | no   | R2 S3 endpoint override (https)                                                                                            |
| `R2_PUBLIC_URL`                  | no   | Validated as https in production; not read anywhere else in the API today                                                  |
| `NODE_ENV`                       | —    | `production` turns on env validation, HSTS, hides `/docs` and `/openapi.json`, and enables the jobs runner                 |
| `PORT`                           | no   | API port (default 4000)                                                                                                    |
| `DB_POOL_MAX`                    | no   | Postgres pool size                                                                                                         |
| `CLIENT_IP_MODE`                 | no   | `cloudflare`, `railway`, or `socket`; see `docs/SECURITY.md` for ingress requirements                                      |
| `AUTH_RATE_PER_IP`               | no   | Sign-in attempts per IP per 15 min (default 20; other auth routes 3×)                                                      |
| `INVITE_RATE_PER_IP`             | no   | Invite accepts per IP per hour (default 10)                                                                                |
| `SIGNUP_RATE_PER_IP`             | no   | Sign-up requests per IP per hour (default 10; sign-up options 6×)                                                          |
| `SIGNUP_RATE_PER_EMAIL`          | no   | Sign-up requests per email per hour (default 3)                                                                            |
| `SIGNUP_COMPANY_SLUG`            | no   | Company that self sign-up requests go to (default `arighna`)                                                               |
| `TURNSTILE_SECRET`               | no   | Cloudflare Turnstile check on sign-up, active only when set (`CAPTCHA_FAILED`)                                             |
| `INVITE_RETURN_LINK`             | no   | Local only: return the invite link in the response (mailer is a stub). Refused when `true` in production                   |
| `EXPENSE_APPROVAL_LEVELS`        | no   | `1`, `2` or `3` approval steps for expense claims (`3`: the last step is the Director)                                     |
| `JOBS_RUNNER_ENABLED`            | no   | `true`/`false`; default on when `NODE_ENV=production`, off otherwise                                                       |
| `JOBS_POLL_MS`                   | no   | Runner poll interval (default 2000)                                                                                        |
| `JOBS_BATCH_SIZE`                | no   | Jobs claimed per poll (default 10)                                                                                         |
| `JOBS_LOCK_TIMEOUT_S`            | no   | Seconds before a locked job is considered stale (default 300)                                                              |
| `DIRECT_URL`                     | —    | Owner connection for migrations and seeds only (`packages/db/.env`). Never set it for the API                              |
| `APP_DB_PASSWORD`                | —    | Local/CI: login password that `db:migrate` gives `ariforce_app`                                                            |
| `NEXT_PUBLIC_API_MODE`           | —    | Web (`apps/web/.env.local`): `mock` (default, MSW) or `real`                                                               |
| `NEXT_PUBLIC_API_BASE_URL`       | —    | Web: API base URL, e.g. `http://localhost:4000`                                                                            |

Script-only, read from your own shell: `ARIFORCE_ADMIN_PASSWORD` and `ARIFORCE_DEMO_PASSWORD`
(`admin:create-first`), `DEMO_PASSWORD` (`pnpm -F @ariforce/api db:seed`, refuses production; has a local default), `CI`.

## 3. Start the API (port 4000)

```sh
pnpm install                                 # first time only
pnpm -F @ariforce/contracts build && pnpm -F @ariforce/db build
pnpm -F @ariforce/api build
pnpm -F @ariforce/api start                  # node dist/main.js, loads apps/api/.env
# or, with reload: pnpm -F @ariforce/api dev
```

Checks:

- `curl http://localhost:4000/v1/health` returns `{"status":"ok","warnings":[]}`. `status` is always
  `ok`. `warnings` is aggregate only (cached about 60 s), one of:
  - `{"code":"NO_WORK_TYPES","count":<n>,"message":"…"}`: n companies have no active work types.
  - `{"code":"WORK_TYPES_CHECK_FAILED","message":"…"}`: the check could not run (DB down or 0026
    missing).

  Company ids and slugs appear only in the API boot log.

- `curl -i http://localhost:4000/v1/me` returns 401 when signed out.
- API reference: http://localhost:4000/docs and `/openapi.json` (not served in production).

### Jobs runner

The DB-backed runner (`apps/api/src/jobs/jobs.runner.ts`, `docs/NOTIFICATIONS.md`) polls the
`jobs` table every `JOBS_POLL_MS`, claims up to `JOBS_BATCH_SIZE` jobs, and reclaims jobs locked for
longer than `JOBS_LOCK_TIMEOUT_S`. It is off by default outside production; set
`JOBS_RUNNER_ENABLED=true` locally to see notifications and the daily exceptions job. Jobs are claimed with `FOR UPDATE SKIP LOCKED` (0028), so two runners do not take the same job. Queue
counts: `GET /v1/jobs/stats`.

## 4. Create the first login (no passwords in chat or git)

Run once, in your own terminal. The password comes from a hidden prompt, or from
`ARIFORCE_ADMIN_PASSWORD` if exported in that shell. It is never printed.

```sh
pnpm -F @ariforce/api admin:create-first --company arighna \
  --email <your-admin-email> --name "System Admin"
```

- `--role director` creates a director instead of a system admin.
- Employees get access through invites (ABM and above): `POST /v1/employees/{id}/invite` or
  `POST /v1/employees/invite-bulk`. The link is single-use for 7 days, only its SHA-256 is stored,
  and the employee sets a password of at least 12 characters at `POST /v1/invites/accept`.
- Demo logins, one per role: add `--demo-users --demo-domain <domain>`; password from
  `ARIFORCE_DEMO_PASSWORD` or the prompt.
- Re-running is idempotent. `--reset-password` sets a new password.

## 5. Sign-in scheme

- better-auth email and password: `POST /v1/auth/sign-in/email` with `{ email, password }`.
- **Browser:** the session cookie `better-auth.session_token` is HttpOnly and `SameSite=Lax`.
  localhost:3000/3200 and localhost:4000 are the same site, so the cookie is sent with
  `credentials: 'include'` (the contracts client does this). CORS allows the `WEB_ORIGIN` list with
  credentials and exposes `Retry-After` and `Content-Disposition`. Use `localhost` everywhere, not
  a mix with `127.0.0.1`.
- **Mobile/CLI:** the sign-in response header `set-auth-token` carries a bearer token; send it as
  `Authorization: Bearer <token>`.
- **Session lifetime:** web cookie hard 18 h from sign-in (`SESSION_MAX_AGE_SECONDS`); mobile
  bearer longer (`MOBILE_SESSION_MAX_AGE_SECONDS`, default 90 days). Cookie attrs
  `AUTH_COOKIE_SAMESITE` / `AUTH_COOKIE_DOMAIN`; see `docs/SECURITY.md`.

## 6. Web app, mock or real

`apps/web/.env.local` (git-ignored):

```sh
NEXT_PUBLIC_API_MODE=real                      # or mock (default)
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

```sh
pnpm -F @ariforce/web dev                      # http://localhost:3000
```

`mock` runs MSW in the browser with the contracts mock handlers. `real` calls the API with the
session cookie. Restart `next dev` after changing the flag.

## 7. Tests

### Test database

API and DB integration tests need a real Postgres and are **skipped** (`describe.skipIf`) when
`DIRECT_URL` or `DATABASE_URL` is not set. `scripts/test-db.sh` creates a throwaway local cluster on
the SSD (`.cache/testdb`, port 54329; override with `ARIFORCE_TESTDB_DIR` / `ARIFORCE_TESTDB_PORT`).
It applies every migration with PostGIS stubbed (`scripts/test-db-postgis-stub.sql`, geometry as
text, GiST as btree), so spatial SQL is not exercised.

```sh
eval "$(sh scripts/test-db.sh up)"     # exports local-only DIRECT_URL and DATABASE_URL
pnpm -F @ariforce/api test
sh scripts/test-db.sh down             # stop and delete the cluster
```

`up` drops and recreates the `ariforce` database each time. Needs `initdb`, `pg_ctl` and `psql`
on `PATH`. Never point tests at the real database.

### scripts/vitest.sh

Every package's `test` script runs `sh ../../scripts/vitest.sh run`. The wrapper sets `HOME` to
`.cache/test-home` (vitest writes a secret token under `os.homedir()`), and pins
`NODE_COMPILE_CACHE` and `TMPDIR` inside the repo, so nothing lands on the internal disk. Pass
vitest arguments through, for example:

```sh
pnpm -F @ariforce/api exec sh ../../scripts/vitest.sh run test/leave.test.ts
```

### Full gate (API side)

```sh
pnpm -r --workspace-concurrency=1 --filter '!@ariforce/web' typecheck
pnpm -r --filter '!@ariforce/web' lint
pnpm exec prettier --check . '!apps/web/public/mockServiceWorker.js'
pnpm -F @ariforce/contracts openapi:check
pnpm -F @ariforce/db db:role-perms:check
pnpm -F @ariforce/db db:sql:check
pnpm -r --workspace-concurrency=1 --filter '!@ariforce/web' test
```
