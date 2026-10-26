# RBAC and authentication (#6)

## Layers (a request must pass all of them)

| Layer                   | Where                                                                                                                                                                                                                                                                                                                                                                                     | Denies with                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1. Session              | better-auth at `/v1/auth/*` (cookie for web, `Authorization: Bearer` for mobile). Global `SessionGuard`; `@Public()` opts out (health, openapi).                                                                                                                                                                                                                                          | 401 `UNAUTHENTICATED`                                         |
| 2. Membership           | `auth_resolve_membership(auth_user_id)` (SECURITY DEFINER) maps the identity to an **active** tenant user + company before any tenant context exists.                                                                                                                                                                                                                                     | 403 `FORBIDDEN`                                               |
| 3. Permission           | `@RequirePermissions(...)` on each route; permissions come from the user's roles (`roles.permissions`).                                                                                                                                                                                                                                                                                   | 403 `FORBIDDEN`                                               |
| 4. Reporting-line scope | `SessionGuard` walks `users.manager_id` down from the caller (recursive, cycle-safe) to get the team; `TenantService.scope()` then filters masters by the territory subtrees of the caller **and their whole team** (`path = p OR path LIKE p \|\| '.%'`). Field data is additionally filtered by `teamUserIds`. Director is company-wide; System Admin is company-wide for masters only. | 404 (no existence leak) on reads, 403 on writes outside scope |
| 5. Tenant (DB)          | Every query runs in `TenantService.run()` = one transaction with `set_config('app.current_company_id', …, true)`; RLS (`FORCE`, policies `TO ariforce_app`) hides other companies even if layers 1-4 have a bug.                                                                                                                                                                          | 404 / 0 rows                                                  |

## Roles (Prajesh, 2026-10-27)

Sales hierarchy, lowest to highest. `rank` is stored on `roles`; keys are the `role_key` enum.

| Rank | Key                         | Title                        | Sees                                                                 |
| ---: | --------------------------- | ---------------------------- | -------------------------------------------------------------------- |
|    1 | `business_manager`          | Business Manager (field rep) | own data and own HQ masters                                          |
|    2 | `area_business_manager`     | Area Business Manager        | self + team below (via `manager_id`)                                 |
|    3 | `regional_business_manager` | Regional Business Manager    | self + team below                                                    |
|    4 | `zonal_business_manager`    | Zonal Business Manager       | self + team below                                                    |
|    5 | `sales_manager`             | Sales Manager                | self + team below                                                    |
|    6 | `general_manager`           | General Manager              | self + team below                                                    |
|    7 | `vice_president`            | Vice President               | self + team below                                                    |
|    8 | `director`                  | Director                     | whole company                                                        |
|    0 | `system_admin`              | System Admin (technical)     | users, masters, imports, settings; **no field data** unless granted  |
|    0 | `distribution_head`         | Distribution Head            | stockists, sales and distribution views, company-wide (`sales:read`) |
|    0 | `accountant`                | Accountant                   | expenses and finance reports, company-wide (`finance:read`)          |

System Admin is outside the hierarchy: no manager, nobody reports to it, it is not an approver, and by default it lacks `field:read`, `field:write`, `approvals:decide` and `reports:read`. Granting field access is an explicit, audited permission change on its role.

Distribution Head and Accountant are functional roles, also outside the hierarchy (rank 0): no reporting line, never a manager, never an approver (no `approvals:decide`, so they cannot decide DCR/TP/corrections), not shown in the team tree. Default data scope: company-wide read of **their own domain only** (`sales:read` = stockists, primary/secondary sales, distribution views; `finance:read` = expenses and finance reports). They do not get `masters:read`, `field:read` or `reports:read`, so no doctor, chemist, DCR, check-in or KPI data by default. The domain endpoints themselves are not built yet; the permissions exist so they can be gated from day one.

Scope follows the **reporting line**, not the role name: a manager sees their own team (everyone whose `manager_id` chain leads to them) and the territories those people are assigned to. An acting manager covering two teams sees both. Skipping levels is fine (a BM may report straight to an RBM).

Territory levels are a separate, geographic hierarchy (`national > zone > region > area > headquarter`) and are not tied to role names. Usual mapping (not enforced): BM → headquarter, ABM → area, RBM → region, ZBM → zone, SM/GM/VP/Director → national (or a zone set).

### Default permissions (`DEFAULT_ROLE_PERMISSIONS` in contracts; seeded per company)

| Permission                                                                       |      BM      | ABM…VP | Director | System Admin | Distribution Head | Accountant |
| -------------------------------------------------------------------------------- | :----------: | :----: | :------: | :----------: | :---------------: | :--------: |
| `me:read`, `roles:read`, `territories:read`                                      |      ✓       |   ✓    |    ✓     |      ✓       |         ✓         |     ✓      |
| `masters:read`                                                                   |      ✓       |   ✓    |    ✓     |      ✓       |                   |            |
| `masters:write` (field-added doctors are `pending` unless director/system admin) |      ✓       |   ✓    |    ✓     |      ✓       |                   |            |
| `field:read` / `field:write`                                                     |    ✓ / ✓     |  ✓ /   |   ✓ /    |              |                   |            |
| `users:read`                                                                     |              |   ✓    |    ✓     |      ✓       |                   |            |
| `approvals:decide`, `reports:read`                                               | reports only |   ✓    |    ✓     |              |                   |            |
| `imports:write`, `settings:write`, `audit:read`                                  |              |        |    ✓     |      ✓       |                   |            |
| `territories:write`, `users:write`                                               |              |        |          |      ✓       |                   |            |
| `sales:read`                                                                     |              |        |          |              |         ✓         |            |
| `finance:read`                                                                   |              |        |          |              |                   |     ✓      |

### Migration from the first role set

`packages/db/migrations/0006_role_hierarchy.sql` renames enum values in place (ids and assignments keep working): rep → business_manager, area_manager → area_business_manager, regional_manager → regional_business_manager, zonal_manager → zonal_business_manager, national_head → director, admin → system_admin (field permissions removed); adds sales_manager, general_manager, vice_president before director. Rows for the three new roles are created by the seed / admin UI (Postgres cannot use a new enum value in the transaction that adds it).

### ADR: functional roles distribution_head and accountant (2026-10-27)

- **Decision**: add two `role_key` values outside the 8-level chain, approved by the lead. Rank 0, like `system_admin`; `inHierarchy=false`.
- **Why not designations**: they need different data access (sales/finance), not just a title. Other titles from the HR file stay free-text designations, not roles.
- **Migrations**: `0014_functional_roles_enum.sql` only adds the enum values (`ADD VALUE IF NOT EXISTS`). `0015_functional_roles_rows.sql` inserts the role rows per company (`ON CONFLICT DO NOTHING`), in a separate transaction because Postgres cannot use a new enum value in the transaction that adds it. Both are safe to re-run; apply 0014, then 0015.
- **Scope**: domain-wide read via `sales:read` / `finance:read` only. Session scope stays non-wide (no territories, team = self), so every existing masters/field/KPI endpoint returns 403 or nothing for them.

## Audit

Append-only `audit_log` (insert-only grant + blocking trigger). Written:

- `auth.sign_in` (better-auth `databaseHooks.session.create.after`) and `auth.sign_out` (`databaseHooks.session.delete.after`; other deletions = `auth.session_revoked`), with IP / user agent.
- Every mutation, **in the same transaction** as the change (`AuditService.record(tx, principal, action, {before, after})`), e.g. `doctor.create`.

## Identities

- better-auth tables `auth_user`, `auth_session`, `auth_account`, `auth_verification` are global (no `company_id`), RLS-forced with an allow-all policy for `ariforce_app` only; `anon`/`authenticated` have no grants (migration 0005).
- Public sign-up is **disabled**. System Admins provision users; the identity is linked via `users.auth_user_id`.
- Local/CI demo identities: `pnpm -F @ariforce/api db:seed` (refuses `NODE_ENV=production`, password from `DEMO_PASSWORD`).
- Env: `BETTER_AUTH_SECRET` (required in production), `BETTER_AUTH_URL`, `WEB_ORIGIN`.

## Module format

better-auth ships ESM only. The API stays CommonJS (Nest decorators/DI) with `module: NodeNext`, so `import` of ESM compiles to `require()` and Node >= 22.12 loads it natively (`require(esm)`); the repo pins Node 24. No dynamic-import wrappers.

## Tests (`apps/api/test/auth-rbac.test.ts`, real Postgres in CI)

401 unauthenticated, wrong password, BM sees only HQ doctors, ABM gets 404 on a sibling team's area, RBM sees both teams, director company-wide, system admin sees masters but has no field permissions and no manager, 404 on another tenant's doctor, 403 creating outside hierarchy, 201 + audit row inside, sign-in/sign-out audited and session revoked, 422 validation shape.
