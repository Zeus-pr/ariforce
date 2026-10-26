# Run AriForce locally against the real database

Everything runs from the SSD checkout (`/Volumes/Prajesh_ext_512/AriForce`). Always start a shell with:

```sh
cd /Volumes/Prajesh_ext_512/AriForce
source scripts/env.sh        # keeps all caches/tools on the SSD
```

Secrets live only in the git-ignored env files `apps/api/.env` and `packages/db/.env`. Variable
names are listed in `.env.example`; never paste values into chat, git or logs.

## 0. One-time: apply the pending SQL (owner, Supabase SQL editor)

The API code expects migrations up to 0017. On the real DB only 0000-0009 (and the hand-applied
`joined_on` column) are present, so apply these files in order (each is safe to re-run):

1. `packages/db/migrations/0010_company_lookup.sql`
2. `packages/db/migrations/0011_field_settings.sql`
3. `packages/db/migrations/0012_tour_plan_days.sql`
4. `packages/db/migrations/0013_dcr_detail.sql`
5. `packages/db/migrations/0014_functional_roles_enum.sql`
6. `packages/db/migrations/0015_functional_roles_rows.sql`
7. `packages/db/migrations/0016_employees_invites.sql`
8. `packages/db/migrations/0017_users_joined_on.sql` (`ADD COLUMN IF NOT EXISTS`, no-op if present)

Until these are applied, `/v1/me`, `/v1/users`, `/v1/team` and the masters fail with "column does
not exist" and `admin:create-first` cannot resolve the company.

`DATABASE_URL` must use the Supabase **transaction pooler** host for this project:
`aws-0-ap-south-1.pooler.supabase.com:6543`, user `ariforce_app.<project-ref>`. (The `aws-1-…` host
returns "tenant/user not found".) The API never uses prepared statements and sets
`app.current_company_id` with `set_config(..., true)` inside each request transaction.

## 1. Start the API (port 4000)

```sh
pnpm install                                 # first time only
pnpm -F @ariforce/contracts build && pnpm -F @ariforce/db build
pnpm -F @ariforce/api build
pnpm -F @ariforce/api start                  # node dist/main.js, loads apps/api/.env
# or, with reload: pnpm -F @ariforce/api dev
```

Checks: `curl http://localhost:4000/v1/health` returns `{"status":"ok"}`, and
`curl -i http://localhost:4000/v1/me` returns 401 when signed out. API docs: http://localhost:4000/docs

Env names (apps/api/.env): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
(`http://localhost:4000`), `WEB_ORIGIN` (default `http://localhost:3000,http://localhost:3200`),
`PORT` (default 4000), `R2_*` for uploads. Don't set `DIRECT_URL` for the API.

## 2. Create the first login (no passwords in chat or git)

Nobody on the real DB can sign in until an auth identity is linked. Run this once, in your own
terminal. The password is read from a hidden prompt, or from `ARIFORCE_ADMIN_PASSWORD` if you
export it in that shell. It is never printed.

```sh
pnpm -F @ariforce/api admin:create-first --company arighna \
  --email <your-admin-email> --name "System Admin"
```

- To give the 25 imported employees access, managers (ABM and above) use the invite flow:
  `POST /v1/employees/{id}/invite` creates a single-use, 7-day link. Only the SHA-256 of the token
  is stored, and the employee picks their own password at `POST /v1/invites/accept`. Locally you can
  set `INVITE_RETURN_LINK=true` to get the link in the response, because the mailer is a stub.
- For demo logins, one per role: add `--demo-users --demo-domain <domain>`. The password comes from
  `ARIFORCE_DEMO_PASSWORD` or the prompt.
- Re-running is idempotent. Add `--reset-password` to set a new password.

## 3. Sign-in scheme

- better-auth email and password, `POST /v1/auth/sign-in/email` with `{ email, password }`.
- **Browser:** the session cookie `better-auth.session_token` is HttpOnly, `SameSite=Lax` and not
  `Secure` on http. localhost:3000 and localhost:3200 are the _same site_ as localhost:4000 (the port
  does not matter for SameSite), so the cookie is sent when the web client uses
  `credentials: 'include'`. The contracts client does this already. The API answers CORS for the
  `WEB_ORIGIN` list with `Access-Control-Allow-Credentials: true`. Use `localhost` everywhere, not a
  mix of `localhost` and `127.0.0.1`, because those are different sites.
- **Mobile/CLI:** the sign-in response header `set-auth-token` carries a bearer token. Send it as
  `Authorization: Bearer <token>`.

## 4. Start the web app and switch between mock and real

`apps/web/.env.local` (git-ignored):

```sh
NEXT_PUBLIC_API_MODE=real                      # or mock (default)
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

```sh
pnpm -F @ariforce/web dev                      # http://localhost:3000
```

`mock` starts MSW in the browser with the contracts mock handlers, so no API is needed. `real`
calls the API with the session cookie. Restart `next dev` after you change the flag.

## Real endpoints available

`/v1/me`; `/v1/doctors`, `/v1/chemists`, `/v1/stockists` (list with `q`, `sort`, `limit`,
`cursor`, `includeTotal=true`, filters such as `territoryId` (subtree), `specialtyId` and
`categoryId`, plus create, PATCH and import dry-run/commit); `/v1/specialties`,
`/v1/doctor-categories`, `/v1/territories`; `/v1/users`; `/v1/team` and `/v1/employees`. See
http://localhost:4000/docs for the full list.
