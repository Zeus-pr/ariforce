# RBAC and authentication (#6)

## Layers (a request must pass all of them)

| Layer              | Where                                                                                                                                                                                                            | Denies with           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1. Session         | better-auth at `/v1/auth/*` (cookie for web, `Authorization: Bearer` for mobile). Global `SessionGuard`; `@Public()` opts out (health, openapi).                                                                 | 401 `UNAUTHENTICATED` |
| 2. Membership      | `auth_resolve_membership(auth_user_id)` (SECURITY DEFINER) maps the identity to an **active** tenant user + company before any tenant context exists.                                                            | 403 `FORBIDDEN`       |
| 3. Permission      | `@RequirePermissions(...)` on each route; permissions come from the user's roles (`roles.permissions`).                                                                                                          | 403 `FORBIDDEN`       |
| 4. Hierarchy scope | `TenantService.scope()` filters by territory path subtree (`path = p OR path LIKE p                                                                                                                              |                       | '.%'`) for every assigned territory. Admin and National Head are company-wide. | 404 (no existence leak) on reads, 403 on writes to a foreign territory |
| 5. Tenant (DB)     | Every query runs in `TenantService.run()` = one transaction with `set_config('app.current_company_id', …, true)`; RLS (`FORCE`, policies `TO ariforce_app`) hides other companies even if layers 1-4 have a bug. | 404 / 0 rows          |

## Role matrix

Production has one tenant (Arighna Pharmaceutical), but every check is still per company.

| Permission                                                        |  Rep   |     Area     |    Regional    |    Zonal     | National |  Admin  |
| ----------------------------------------------------------------- | :----: | :----------: | :------------: | :----------: | :------: | :-----: |
| `me:read`, `roles:read`, `territories:read`                       |   ✓    |      ✓       |       ✓        |      ✓       |    ✓     |    ✓    |
| `masters:read` (doctors, chemists, stockists)                     | own HQ | area subtree | region subtree | zone subtree | company  | company |
| `masters:write` (new doctors are `pending` approval unless admin) | own HQ |   subtree    |    subtree     |   subtree    | company  | company |
| `users:read`                                                      |        |      ✓       |       ✓        |      ✓       |    ✓     |    ✓    |
| `approvals:decide`                                                |        |      ✓       |       ✓        |      ✓       |    ✓     |    ✓    |
| `territories:write`, `users:write`, `audit:read`                  |        |              |                |              |          |    ✓    |

Scope = the subtree of the user's **assigned territories** (`user_territories`), not the role name, so an acting manager covering two areas sees both.

## Audit

Append-only `audit_log` (insert-only grant + blocking trigger). Written:

- `auth.sign_in` (better-auth `databaseHooks.session.create.after`) and `auth.sign_out` (`databaseHooks.session.delete.after`; other deletions = `auth.session_revoked`), with IP / user agent.
- Every mutation, **in the same transaction** as the change (`AuditService.record(tx, principal, action, {before, after})`), e.g. `doctor.create`.

## Identities

- better-auth tables `auth_user`, `auth_session`, `auth_account`, `auth_verification` are global (no `company_id`), RLS-forced with an allow-all policy for `ariforce_app` only; `anon`/`authenticated` have no grants (migration 0005).
- Public sign-up is **disabled**. Admins provision users; the identity is linked via `users.auth_user_id`.
- Local/CI demo identities: `pnpm -F @ariforce/api db:seed` (refuses `NODE_ENV=production`, password from `DEMO_PASSWORD`).
- Env: `BETTER_AUTH_SECRET` (required in production), `BETTER_AUTH_URL`, `WEB_ORIGIN`.

## Module format

better-auth ships ESM only. The API stays CommonJS (Nest decorators/DI) with `module: NodeNext`, so `import` of ESM compiles to `require()` and Node >= 22.12 loads it natively (`require(esm)`); the repo pins Node 24. No dynamic-import wrappers.

## Tests (`apps/api/test/auth-rbac.test.ts`, real Postgres in CI)

401 unauthenticated, wrong password, rep sees only HQ doctors, area manager gets 404 on a sibling area, admin company-wide but 404 on another tenant's doctor, 403 creating outside hierarchy, 201 + audit row inside, sign-in/sign-out audited and session revoked, 422 validation shape.
