# SFC: Standard Fare Chart

The SFC is one table per employee that lists the routes they travel from their HQ and what each route pays. It replaces the web "TA/DA rates" page (the rate card and fare-chart admin screens of #39). Expense claims and allowance lines are unchanged.

## Data (migration 0038)

- `sfc_routes`, one row per route, per employee (`user_id`), with:
  - `hq_territory_id`: the HQ of the table. It must be one of the employee's assigned territories.
  - `sort_order`, `from_place`, `to_place`.
  - `one_way_km`, `both_way_km`.
  - `one_way_amount` and `both_way_amount`. Both are `null` when the row is an actual fare.
  - `actual_fare`: the employee is paid what the ticket cost.
  - `travel_mode`: one of `bike`, `bus`, `train`, `bus_train`, `car`, `other`, or null.
  - `category`: free text up to 40 characters, e.g. `HQ`, `EX`, `EX HQ`, `OUT EX HQ`, `EX / OS`, `OS`, `MEETING`.
  - `da`: optional, stored as typed.
  - `created_by`, `updated_by`, `version`, `deleted_at`.
  - Row-level security works like every other tenant table: RLS and FORCE RLS, the `tenant_isolation` policy for `ariforce_app`, and the `row_meta` trigger.
- `companies.sfc_rate_per_km`: the company's rate, default **2.95** INR per km.

## Amounts (computed by the server on every save)

- `both_way_km = 2 × one_way_km`
- `one_way_amount = round2(one_way_km × rate)`, or null for an actual fare
- `both_way_amount = 2 × one_way_amount`, or null for an actual fare
- DA is stored as typed.

Changing the rate does not recompute saved rows. A table picks up the new rate the next time it is saved.

## Who can do what

| Caller                        | Sees                         | Edits                       |
| ----------------------------- | ---------------------------- | --------------------------- |
| BM                            | Own table (read-only)        | Nothing                     |
| ABM … VP                      | Self and everyone below them | People below them, not self |
| Director                      | Everyone in the company      | Everyone except self        |
| System Admin                  | Everyone in the company      | Everyone                    |
| Distribution Head, Accountant | Nothing (403)                | Nothing                     |

- Permissions are `sfc:read` (BM and up, plus system_admin) and `sfc:write` (ABM and up, plus system_admin). Migration 0039 adds them.
- Only sales-hierarchy employees (rank 1 or higher) have an SFC.
- Changing the rate needs `settings:write` (director and system_admin).

## Endpoints

- `GET /v1/sfc/settings`: returns `{ ratePerKm, version }`.
- `PUT /v1/sfc/settings`: takes `{ ratePerKm, version }`. Can return 409 `VERSION_CONFLICT`.
- `GET /v1/sfc/hqs`: returns `{ items: [{ id, name, code, level, parentId, parentName, employeeCount, routeCount }] }`. These are the headquarter-level territories in the caller's scope, subtree included.
- `GET /v1/sfc/employees?territoryId=`: returns `{ items: [{ id, name, employeeCode, role, rank, hqTerritoryIds, routeCount, hasSfc, canEdit }] }`. These are the visible employees assigned to that territory or anywhere below it.
- `GET /v1/sfc/employees/{userId}/routes`: returns `{ userId, userName, hqTerritoryId, ratePerKm, etag, canEdit, routes[] }`.
- `PUT /v1/sfc/employees/{userId}/routes`: takes `{ etag, hqTerritoryId, routes: [{ id?, fromPlace, toPlace, oneWayKm, actualFare, travelMode, category, da }] }`.
  - The PUT sends the **whole table** in display order.
  - A row with an `id` is kept and updated. A row without one is added. Rows that are left out are soft-deleted.
  - Errors:
    - 403 `FORBIDDEN`
    - 404 `NOT_FOUND`
    - 409 `VERSION_CONFLICT`: `details.etag` holds the current etag
    - 422 `VALIDATION`
    - 422 `SFC_HQ_NOT_ASSIGNED`
    - 422 `SFC_ROUTE_NOT_FOUND`
  - Each save writes one audit entry, `sfc.routes_saved`, with the routes before and after.

### Concurrency

The `etag` covers every row of the table, including deleted ones, so a change by anyone changes it. Saves of the same table are serialised with an advisory lock, which also covers a table that has no rows yet (its etag is `""`). If the etag does not match, reload the table and try again.

## Importer (`apps/api/scripts/import-sfc.mts`)

```
pnpm -F @ariforce/api sfc:import --company <slug> --file <sfc.xlsx>            # dry run
pnpm -F @ariforce/api sfc:import --company <slug> --file <sfc.xlsx> --apply    # write
```

- **Sheet layout:** each sheet has a `BM NAME : <name>` cell, an `HQ : <hq>` cell, then a header row (`SL. NO | FROM PLACE | TO PLACE | Distance One way | … | Category`).
- **Matching:** the BM is fuzzy-matched by name **and** HQ. For example, the sheet's "SUROJIT SHIKARI" matches the employee "Suraji Shikari". Unmatched sheets, ambiguous sheets, and two sheets that match the same person are reported and skipped. In those cases the exit code is 2.
- **Cleaning:**
  - km text such as `71 KM` or `50KM` becomes a number.
  - `ACTUAL FARE` sets `actual_fare`.
  - `BUS / TRAIN` becomes `bus_train`.
  - Category spacing is unified (`EX/ OS` becomes `EX / OS`).
  - Numbered rows with no places are skipped.
  - Amounts in the sheet are ignored and recomputed. For example, the sheet's 88.05 for 30 km becomes 88.50.
- **Idempotent:** a row is matched on employee, from, to and category. Re-runs report rows as `unchanged`. Routes that are in the database but not in the sheet are kept and counted.
- **Output:** the script prints names only. It connects with `DATABASE_URL` (the app role, so RLS applies) and writes an `sfc.imported` audit entry per sheet.
