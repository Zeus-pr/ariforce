# Data model v1

Source: `packages/db/src/schema/*.ts` (Drizzle) + `packages/db/drizzle/*.sql` migrations.
`0000_extensions` (PostGIS) -> `0001_init` (generated tables) -> `0002_security` (hand-written: app role, grants, RLS, triggers, audit).

## Conventions

- **Ids**: UUIDv7 (`uuid` v7, generated app-side; clients may generate offline). `audit_log` uses a bigint identity.
- **Tenancy**: `company_id uuid NOT NULL` on every tenant table, FK to `companies`. RLS `ENABLE` + `FORCE`, policy `company_id = app_company_id()` for `USING` and `WITH CHECK`. `app_company_id()` reads `current_setting('app.current_company_id')`, set per transaction by `withTenant()` (`SET LOCAL` semantics). Unset -> no rows.
- **DB roles**: migrations/seed run as the owner (`DATABASE_URL`). The API runs as `ariforce_app` (`DATABASE_URL_APP`): `NOSUPERUSER NOBYPASSRLS`, so RLS always applies.
- **Sync columns**: `created_at`, `updated_at`, `deleted_at` (soft delete / tombstone), `version` (int). Trigger `set_row_meta` bumps `version`, sets `updated_at` and pins `company_id` on every UPDATE.
- **Hierarchy**: `territories.path` = dot-joined ancestor ids (root..self); subtree = `path LIKE '<path>%'` (indexed with `text_pattern_ops`). People hierarchy: `users.manager_id`. Hierarchy scoping is enforced in the API (#6, `docs/RBAC.md`); RLS enforces the tenant boundary.
- **Geo**: PostGIS `geometry(Point,4326)` for doctor/chemist/stockist locations and territory centroids; `geometry(MultiPolygon,4326)` for territory boundaries; GiST indexes.
- **Audit**: `audit_log` is append-only: app role has only `SELECT, INSERT`; `UPDATE/DELETE/TRUNCATE` revoked and blocked by trigger for every role (including the owner).
- **Times**: `timestamptz` (UTC); business dates (`plan_sessions.date`) are IST calendar dates `YYYY-MM-DD`.

## Research-driven additions (PR #16, issues #17+)

| Need                               | Modelled now as                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic approval engine (#17)      | `approval_requests` (entity_type/entity_id, state, current_step, reason, payload) + `approval_steps` (ordered; approver by role-in-hierarchy or explicit user; decision + comment) |
| Configurable work types (#18)      | `work_types` (kind field/non_field/leave/holiday, counts_as_field_day, allowance_band hq/ex_hq/outstation for TA/DA #39, requires_location)                                        |
| Cycle length (#18)                 | `companies.cycle_kind` (`month` or `days`) + `cycle_length_days` + `cycle_anchor_date`                                                                                             |
| Multi-session days (#21)           | `plan_sessions` (user, date, session_no, work_type, territory)                                                                                                                     |
| DCR lock (#23)                     | `companies.dcr_lock_after_hours`; corrections via `approval_requests(entity_type='dcr_correction')`                                                                                |
| DCR prefill + deviation (#22)      | `approval_requests(entity_type='tp_deviation')`; DCR tables come with #10 and reference `plan_sessions`                                                                            |
| Doctor grade + frequency (#25)     | `doctor_categories.visits_per_cycle` (A/B/C seeded 3/2/1) + `doctors.visits_per_cycle_override`                                                                                    |
| Doctor geo-tag + geofence (#24)    | `doctors.location`, `geo_tagged_at/by`, `geofence_radius_m` (10-2000, null = `companies.default_geofence_m`)                                                                       |
| Field-added doctor approval (#26)  | `doctors.approval_status` + approval request `entity_type='doctor'`                                                                                                                |
| Registration verification (#27)    | `doctors.registration_no/council`, `verification_status`                                                                                                                           |
| KPI views (#28), samples (#37/#38) | Later migrations (views over DCR/TP; sample ledger + per-doctor cap). Not in v1.                                                                                                   |

## ER diagram

```mermaid
erDiagram
  companies ||--o{ users : has
  companies ||--o{ roles : has
  companies ||--o{ territories : has
  users ||--o{ user_roles : ""
  roles ||--o{ user_roles : ""
  users ||--o{ user_territories : ""
  territories ||--o{ user_territories : ""
  territories ||--o{ territories : parent
  users ||--o{ users : manager
  territories ||--o{ doctors : ""
  territories ||--o{ chemists : ""
  territories ||--o{ stockists : ""
  specialties ||--o{ doctors : ""
  doctor_categories ||--o{ doctors : grade
  work_types ||--o{ plan_sessions : ""
  users ||--o{ plan_sessions : plans
  users ||--o{ approval_requests : requests
  approval_requests ||--o{ approval_steps : chain
  companies ||--o{ audit_log : ""

  companies { uuid id PK; text slug; text cycle_kind; int cycle_length_days; int default_geofence_m; int dcr_lock_after_hours }
  users { uuid id PK; uuid company_id; text auth_user_id; text email; uuid manager_id; user_status status }
  roles { uuid id PK; uuid company_id; role_key key; int rank; text_arr permissions }
  territories { uuid id PK; uuid company_id; uuid parent_id; territory_level level; text path; geometry centroid; geometry boundary }
  doctors { uuid id PK; uuid company_id; uuid territory_id; uuid category_id; int visits_per_cycle_override; geometry location; int geofence_radius_m; verification_state verification_status; approval_state approval_status }
  work_types { uuid id PK; uuid company_id; text code; work_type_kind kind; bool counts_as_field_day; text allowance_band }
  plan_sessions { uuid id PK; uuid company_id; uuid user_id; text date; int session_no; uuid work_type_id }
  approval_requests { uuid id PK; uuid company_id; text entity_type; uuid entity_id; approval_state state; int current_step }
  approval_steps { uuid id PK; uuid request_id; int step_no; role_key approver_role; approval_state decision }
  audit_log { bigint id PK; uuid company_id; uuid actor_user_id; text action; jsonb before; jsonb after; timestamptz at }
```

## Seed (`pnpm -F @ariforce/db db:seed`)

One demo company, territory chain India > East Zone > West Bengal > Kolkata North > Shyambazar HQ (+ Kolkata South), one user per role (+ a second rep outside the area manager's subtree for denial tests), specialties, A/B/C grades, work types, sample doctors/chemist/stockist.

## Tests

`packages/db/test/rls.test.ts` (runs when `DATABASE_URL` and `DATABASE_URL_APP` are set, always in CI): app role not superuser; no context -> no rows; cross-tenant read/insert/update/delete fail; company_id immutable; version bump; audit_log append-only; every tenant table has NOT NULL `company_id` and forced RLS.
