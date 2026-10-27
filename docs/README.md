# AriForce docs index

The contract source of truth is the zod schemas in `packages/contracts`. The generated OpenAPI
document is committed at `docs/api/openapi.json` (`pnpm -F @ariforce/contracts openapi`, checked by
`openapi:check`). Contract changes by feature: [CHANGELOG-CONTRACTS.md](CHANGELOG-CONTRACTS.md).

## Architecture and data model

| File                           | What it covers                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------ |
| [BRIEF.md](BRIEF.md)           | Build brief: owner, roles of the agents, Phase 0 / website MVP scope, SSD rule |
| [DATA-MODEL.md](DATA-MODEL.md) | Drizzle schema, how migrations are exported, tables and RLS overview           |
| [STORAGE.md](STORAGE.md)       | Cloudflare R2 file storage with presigned URLs; the API never proxies bytes    |
| [WEB-LAYOUT.md](WEB-LAYOUT.md) | `apps/web`, `packages/ui` (shadcn) and `packages/config` layout                |
| [UI-SOURCES.md](UI-SOURCES.md) | Third-party UI components and their licenses                                   |

## API conventions and RBAC

| File                                     | What it covers                                                        |
| ---------------------------------------- | --------------------------------------------------------------------- |
| [API-CONVENTIONS.md](API-CONVENTIONS.md) | v1 conventions: errors, paging, sorting, versions, OpenAPI generation |
| [RBAC.md](RBAC.md)                       | Authentication, roles, permissions, hierarchy scope, RLS layers (#6)  |
| [api/openapi.json](api/openapi.json)     | Generated OpenAPI 3.1 document (do not edit by hand)                  |

## Security

| File                       | What it covers                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [SECURITY.md](SECURITY.md) | Session revocation (#79), env validation (#80), client IP and rate limits (#77), headers and docs (#81), CORS |

## Feature docs

| File                                     | What it covers                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| [SIGNUP.md](SIGNUP.md)                   | Self sign-up requests, approval, sign-in account states                          |
| [FIELD.md](FIELD.md)                     | Attendance, check-ins, devices, GPS capture rules                                |
| [TOUR-PLANS.md](TOUR-PLANS.md)           | Tour plan storage, submit rule, calendar, approvals                              |
| [DCR.md](DCR.md)                         | Daily Call Report endpoints and rules                                            |
| [POB-RCPA.md](POB-RCPA.md)               | POB on doctor/chemist calls (server-computed value), RCPA on chemist calls (#40) |
| [DOCTOR-APPROVAL.md](DOCTOR-APPROVAL.md) | Field-added doctor approval and duplicate detection (#26)                        |
| [APPROVALS.md](APPROVALS.md)             | Approval request details (GET /v1/approvals/{id}) and required rejection reasons |
| [PRODUCTS.md](PRODUCTS.md)               | System Admin product prices (MRP/PTR/PTS) with append-only history               |
| [EXPENSES.md](EXPENSES.md)               | Expense claims, lines, receipts, approvals, payment, reports (#52)               |
| [TADA.md](TADA.md)                       | TA/DA rate card, fare chart and allowance drafting (#39)                         |
| [SFC.md](SFC.md)                         | SFC (Standard Fare Chart) routes per employee; replaces the TA/DA rates page     |
| [LEAVE.md](LEAVE.md)                     | Leave types, requests, approvals, balances, grants, backdating window (#51)      |
| [TEAM-PROFILE.md](TEAM-PROFILE.md)       | Team member profile, performance and export (#75)                                |
| [NOTIFICATIONS.md](NOTIFICATIONS.md)     | DB job runner and in-app notifications (#35)                                     |
| [EXCEPTIONS.md](EXCEPTIONS.md)           | Exception rules and the Needs Attention list (#56, #29)                          |

## Import

| File                   | What it covers                                                  |
| ---------------------- | --------------------------------------------------------------- |
| [IMPORT.md](IMPORT.md) | Excel/CSV import templates, dry run and commit, duplicate rules |

## KPI

| File                                     | What it covers                            |
| ---------------------------------------- | ----------------------------------------- |
| [kpi-definitions.md](kpi-definitions.md) | KPI definitions and the `kpi_*` SQL views |

## Run and ops

| File                                                                | What it covers                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [SETUP.md](SETUP.md)                                                | Toolchain and first-time setup on the SSD                                           |
| [RUN-LOCAL.md](RUN-LOCAL.md)                                        | Migrations 0000–0035, env vars, running the API and web, health, jobs runner, tests |
| [data-fixes/README.md](../packages/db/scripts/data-fixes/README.md) | One-off data-fix SQL scripts (lead runs as DB owner) with run order                 |
| [CHANGELOG-CONTRACTS.md](CHANGELOG-CONTRACTS.md)                    | API contract changes by feature, breaking changes first                             |

## Cutly checklist

There is no separate checklist file in `docs/`; the Cutly audit items are covered section by section
in [SECURITY.md](SECURITY.md).

## Decisions recorded

- Doctors (#26): BM/ABM cannot propose doctors (Prajesh decided; `doctors:propose` cancelled).
  Doctor-approval notifications come later. See [DOCTOR-APPROVAL.md](DOCTOR-APPROVAL.md).

## Branch and migration map

Which commit (and branch) first added each migration. Commit hashes are on `origin`. Branches
built on each other, so an earlier migration is also on every later branch.

| Migrations | Commit    | Branch                                                                     |
| ---------- | --------- | -------------------------------------------------------------------------- |
| 0000–0003  | `1d4d85c` | `feat/5-data-model`                                                        |
| 0004       | `722c9e7` | `feat/5-data-model`                                                        |
| 0005       | `408d954` | `feat/6-auth-rbac`                                                         |
| 0006       | `6ffc314` | lineage of `feat/signup-requests` (pre-signup work)                        |
| 0007–0009  | `5c18c4a` | lineage of `feat/signup-requests`                                          |
| 0010       | `c121abc` | lineage of `feat/signup-requests`                                          |
| 0011       | `4459557` | lineage of `feat/signup-requests`                                          |
| 0012       | `a222af0` | lineage of `feat/signup-requests`                                          |
| 0013       | `21706ad` | lineage of `feat/signup-requests`                                          |
| 0014–0015  | `594926a` | lineage of `feat/signup-requests`                                          |
| 0016       | `db132f1` | lineage of `feat/signup-requests`                                          |
| 0017       | `6a3fcd4` | lineage of `feat/signup-requests`                                          |
| 0018       | `a21f1b7` | lineage of `feat/signup-requests`                                          |
| 0019       | `49bd156` | lineage of `feat/signup-requests` (role-permissions seed)                  |
| 0020       | `c067e17` | `feat/signup-requests`                                                     |
| 0021–0022  | `f526c08` | `feat/signup-requests` (expenses #52 landed on this branch; tip `ddcb66e`) |
| 0023–0025  | `59fa8ba` | `feat/51-leave`                                                            |
| 0026       | `0c97952` | `fix/work-types-seed`                                                      |
| 0027       | `a575db1` | `feat/26-invite-gaps`                                                      |
| 0028       | `4fa4151` | `feat/35-notifications`                                                    |
| 0029       | `6a9cc91` | `feat/40-pob-rcpa`                                                         |
| 0030       | `0d5039e` | `fix/jobs-functions-hardening`                                             |
| 0031       | `58433c3` | `feat/56-exceptions`                                                       |
| 0032–0033  | `acafccf` | `feat/product-prices-admin`                                                |
| 0034       | `6d66770` | `feat/39-tada-allowances`                                                  |
| 0035       | `e578119` | `feat/26-doctor-approval`                                                  |

`origin/feat/20-real-api` is the web integration branch. It has 0000–0034, but not 0035.

## Applied status (production)

As of 2026-10-27, **as reported by the lead, not verified from this repo**: 0000–0034 applied;
0035 being applied. (0017 was first hand-applied as "0010a"; the file is `IF NOT EXISTS`.)
