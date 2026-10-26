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

Distribution Head and Accountant are functional roles, also outside the hierarchy (rank 0): no reporting line, never a manager, never an approver (no `approvals:decide`, so they cannot decide DCR/TP/corrections), not shown in the team tree. Default data scope: company-wide read of **their own domain only** (`sales:read` = stockists, primary/secondary sales, distribution views; `finance:read` = expenses and finance reports). They do not get `masters:read`, `field:read` or `reports:read`, so no doctor, chemist, DCR, check-in or KPI data by default (masters read access: see the accepted section below). The domain endpoints themselves are not built yet; the permissions exist so they can be gated from day one.

Scope follows the **reporting line**, not the role name: a manager sees their own team (everyone whose `manager_id` chain leads to them) and the territories those people are assigned to. An acting manager covering two teams sees both. Skipping levels is fine (a BM may report straight to an RBM).

Territory levels are a separate, geographic hierarchy (`national > zone > region > area > headquarter`) and are not tied to role names. Usual mapping (not enforced): BM → headquarter, ABM → area, RBM → region, ZBM → zone, SM/GM/VP/Director → national (or a zone set).

### Default permissions (`DEFAULT_ROLE_PERMISSIONS` in contracts; seeded per company)

| Permission                                                                               |      BM      | ABM | RBM…VP | Director | System Admin | Distribution Head | Accountant |
| ---------------------------------------------------------------------------------------- | :----------: | :-: | :----: | :------: | :----------: | :---------------: | :--------: |
| `me:read`, `roles:read`, `territories:read`                                              |      ✓       |  ✓  |   ✓    |    ✓     |      ✓       |         ✓         |     ✓      |
| `masters:read` (doctors, chemists, work types)                                           |      ✓       |  ✓  |   ✓    |    ✓     |      ✓       |                   |            |
| `stockists:read`                                                                         |      ✓       |  ✓  |   ✓    |    ✓     |      ✓       |         ✓         |            |
| `products:read` (products, divisions, HQ mappings)                                       |      ✓       |  ✓  |   ✓    |    ✓     |      ✓       |         ✓         |     ✓      |
| `masters:write`, `territories:write`, `imports:write` (create, edit, import, deactivate) |              |     |   ✓    |    ✓     |      ✓       |                   |            |
| `field:read` / `field:write`                                                             |    ✓ / ✓     | ✓ / |  ✓ /   |   ✓ /    |              |                   |            |
| `users:read`                                                                             |              |  ✓  |   ✓    |    ✓     |      ✓       |                   |            |
| `approvals:decide`, `reports:read`                                                       | reports only |  ✓  |   ✓    |    ✓     |              |                   |            |
| `settings:write`, `audit:read`                                                           |              |     |        |    ✓     |      ✓       |                   |            |
| `users:write`                                                                            |              |     |        |          |      ✓       |                   |            |
| `sales:read`                                                                             |              |     |        |          |              |         ✓         |            |
| `finance:read`                                                                           |              |     |        |          |              |                   |     ✓      |

Field-added doctors are `pending` unless created by a director or system admin.

### Masters permissions (lead rule, 2026-10-27)

- **Write** (create, edit, import dry-run and save, deactivate) on doctors, chemists, stockists, products, divisions, territories, work types, HQ mappings and imports: RBM and above (rank >= 3: RBM, ZBM, SM, GM, VP, Director) and System Admin. Constant: `MASTERS_WRITE` / `MASTERS_WRITE_MIN_RANK = 3` in `packages/contracts/src/schemas/roles.ts`.
- **ABM and BM are read-only** on masters: every write returns 403 `Missing permission: ...`.
- `GET /v1/imports/{id}` needs `imports:write` (write roles only).
- Reads stay scoped to the caller's subtree (company-wide for System Admin, Distribution Head and Accountant).
- My Team add-employee flow is unchanged (see "Team and employees").
- Per-endpoint permissions are in the OpenAPI document as `x-required-permissions` on each masters operation (`mastersPermissions(path, method)` in `packages/contracts/src/openapi.ts`). Reads: territories → `territories:read`; stockists → `stockists:read`; products, divisions, product-hq-mappings → `products:read`; doctors, chemists, work types → `masters:read`. Writes: `masters:write` (territories: `territories:write`); import endpoints also need `imports:write`.
- The mock (`packages/contracts/src/mocks/masters-guard.ts`) returns the same 403s.
- SQL: `packages/db/migrations/0018_masters_write_rbm_up.sql` (idempotent).

### Distribution Head and Accountant masters access: **accepted (lead, 2026-10-27)**

- Distribution Head: read-only on stockists, products, divisions and territories, plus `sales:read`. No doctors or chemists.
- Accountant: read-only on products, divisions and territories, plus `finance:read`. No doctors, chemists or stockists.
- Neither role writes masters.

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

401 unauthenticated, wrong password, BM sees only HQ doctors, ABM gets 404 on a sibling team's area, RBM sees both teams, director company-wide, system admin sees masters but has no field permissions and no manager, 404 on another tenant's doctor, BM/ABM 403 on masters writes, RBM 403 creating outside its hierarchy and 201 + audit row inside, sign-in/sign-out audited and session revoked, 422 validation shape.

## Team and employees

The server enforces every rule in `apps/api/src/team/team.service.ts`, and the mock in
`packages/contracts/src/mocks/team.ts` mirrors it.

- `GET /v1/team` returns the caller's reporting-line subtree, depth-first. Each node has its
  role(s), free-text `designation`, `joinedOn`, code, phone, email, territories (city, state and
  centroid), status and direct-report count.
  `unassigned` lists hierarchy users with no `manager_id` whose territory is in the caller's scope,
  ranked below the caller. Only ABM and above see it. Directors see the whole company.
- Functional roles (`system_admin`, `distribution_head`, `accountant`) never appear in the tree and
  cannot be granted through this flow.
- Create (`POST /v1/employees`), edit, deactivate or move (`PATCH /v1/employees/{id}`), and assign
  a manager (`POST /v1/team/{id}/manager`):
  - The caller must be ABM (rank 2) or above.
  - The role must be a hierarchy role strictly below the caller's.
  - Territories must be inside the caller's territory subtree.
  - The manager must be the caller or someone in their subtree, and rank above the target.
  - The target must be below the caller and either in their subtree or unassigned in their scope.
  - Callers cannot change themselves, peers or anyone above them.
  - A reporting cycle returns 409 and a stale `version` returns 409.
  - Every change writes to `audit_log` (`employee.created`, `employee.updated`,
    `employee.deactivated`, `employee.manager_assigned`, `employee.invited`,
    `employee.invite_accepted`).
- Invites are single-use, expire after 7 days and are stored only as a SHA-256 hash. Re-inviting
  revokes the earlier token. `POST /v1/invites/accept` (public) creates the better-auth identity
  and activates the user. The mailer is a stub that logs only the invite id.
- `designation` is free text from HR and has no effect on permissions.
- No payroll or HR-sensitive data (PAN, bank, CTC, nominee) is stored in app tables or contracts.
- Chemists are an independent master with no doctor link, and the chemist import does not need one.
