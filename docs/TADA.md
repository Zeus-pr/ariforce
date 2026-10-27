# TA/DA auto-calculation (#39)

> **SFC replaces the rate admin (2026-10-27).** The web "TA/DA rates" page is replaced by the SFC page (docs/SFC.md). The rate card and fare-chart admin endpoints (`/v1/allowance-rates*`, `/v1/allowance-places*`) still work but are **deprecated** in OpenAPI; do not build new screens on them.
>
> **Replaced by SFC:** the rate card and fare chart admin screens, plus the HQ places list.
>
> **Unchanged:** expense claims, allowance lines (`source`, `calc`, `allowancePlaceId`), `POST /v1/expense-claims/{id}/allowances`, and claim approval and payment.
>
> **Proposal, not built:** TA drafting could read SFC instead of `allowance_places`. For each DCR day, the engine would match the DCR place to an SFC route of the rep (`to_place`, case-insensitive) and use that route's `both_way_amount` as TA. An actual-fare route would become a manual line that needs a receipt. DA would come from `sfc_routes.da` when it is set, otherwise from the rate card. Until then, drafting uses the rate card and fare chart as before.

Issue #39: "TA/DA auto-calc from distance rate card and work type" (research P2; use case "daily auto-draft from DCR work type and distance").
This adds a company **rate card**, a **standard fare chart** of places per HQ, and an endpoint that drafts TA/DA lines into the rep's monthly expense claim (#52) from their DCRs.
Regulatory detail (e.g. tax treatment of allowances) is not modelled; verify with counsel before relying on it.

## Inputs

- **Band** comes from the DCR's work type: `work_types.allowance_band` = `hq` / `ex_hq` / `outstation` / `none` (already seeded: FIELD_HQ, FIELD_EXHQ, FIELD_OUT). `none` (meetings, leave, holidays...) gets nothing.
- **Rate card** (`allowance_rates`): per band, optionally per role, with an `effective_from` date:
  - `daAmount`: daily allowance per day in that band.
  - `taPerKm`: travel allowance per km (ex-HQ / outstation).
  - `taFixed`: flat local conveyance per day (typically HQ).
  - The rate used for a day = the row for the band with the latest `effective_from <= date`, preferring a row for the rep's role over the all-roles row (`roleKey = null`).
- **Standard fare chart** (`allowance_places`): places (town names) per HQ territory with a band and a one-way distance in km. Distance is **not** GPS: territories stop at HQ level, PostGIS distance is not exercised locally, and Indian pharma TA is normally paid on a fixed chart.

## Calculation (per day of the claim month)

Days considered: the rep's DCRs in the claim month with status `submitted` or `locked`, on or before today, whose work type band is not `none`.

| Band         | DA lines            | TA line                                                                                                |
| ------------ | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `hq`         | `daAmount` (if > 0) | `taFixed` as a `travel` line (if > 0)                                                                  |
| `ex_hq`      | `daAmount`          | `mileage` line: km = 2 × place one-way km (round trip), amount = km × `taPerKm`, plus `taFixed` if set |
| `outstation` | `daAmount`          | same as `ex_hq`                                                                                        |

- DA lines use a new expense category **`allowance`**. TA uses the existing `mileage` (km required) and `travel` categories.
- The place for an ex-HQ/outstation day comes from the request (`places: {date: placeId}`), else the place used for that date last time, else the only active place of that band for the rep's HQ. Otherwise the day is reported with issue `place_required` and gets DA only.
- Amounts are rounded to 2 decimals; each auto line links the day's DCR (`dcrId`) and stores a `calc` snapshot (band, rate id, place id, km, per-km rate) so later rate changes do not alter drafted lines.

## Re-running and manual edits

- Lines carry `source` = `manual` | `auto`. Re-running replaces only `auto` lines for the claim; manual lines are never touched.
- Editing an auto line (PUT) or attaching a receipt to it turns it into `manual`.
- A day that already has a manual `allowance` or `mileage` line is skipped (issue `manual_line_exists`), so nothing is double-claimed.
- Only the owner can draft, and only while the claim is `draft` or `rejected` (same as adding lines). `dryRun: true` returns the computation without writing.

## Endpoints

| Method & path                             | Permission                                          | Body / query                               | 2xx                        |
| ----------------------------------------- | --------------------------------------------------- | ------------------------------------------ | -------------------------- |
| `GET /v1/allowance-rates`                 | `expenses:read`, `finance:read` or `settings:write` | `?band&roleKey`                            | 200 `AllowanceRateList`    |
| `POST /v1/allowance-rates`                | `settings:write`                                    | `AllowanceRateInput`                       | 201 `AllowanceRate`        |
| `PUT /v1/allowance-rates/{id}`            | `settings:write`                                    | `AllowanceRateUpdate` (input + `version`)  | 200 `AllowanceRate`        |
| `DELETE /v1/allowance-rates/{id}`         | `settings:write`                                    |                                            | 204                        |
| `GET /v1/allowance-places`                | `expenses:read`, `finance:read` or `settings:write` | `?hqTerritoryId&band&q&includeInactive`    | 200 `AllowancePlaceList`   |
| `POST /v1/allowance-places`               | `settings:write`                                    | `AllowancePlaceInput`                      | 201 `AllowancePlace`       |
| `PUT /v1/allowance-places/{id}`           | `settings:write`                                    | `AllowancePlaceUpdate` (input + `version`) | 200 `AllowancePlace`       |
| `DELETE /v1/allowance-places/{id}`        | `settings:write`                                    |                                            | 204 (soft delete)          |
| `POST /v1/expense-claims/{id}/allowances` | `expenses:write` (owner, draft/rejected claim)      | `AllowanceDraftRequest {dryRun?, places?}` | 200 `AllowanceDraftResult` |

Errors: 409 `DUPLICATE_RATE` / `DUPLICATE_PLACE`, 409 `VERSION_CONFLICT`, 422 `VALIDATION`, 422 `NOT_HQ_TERRITORY`, 422 `PLACE_NOT_USABLE` (unknown/inactive/other HQ/band `hq`), plus the expense-claim errors (403 not owner, 404, 409 `EXPENSE_NOT_EDITABLE`).
No new permissions.

MSW mocks: `packages/contracts/src/mocks/allowances.ts` (rate card, fare chart) and the draft handler in `mocks/expenses.ts`. Mock simplifications: any fixture territory counts as an HQ; the draft treats every weekday of the month up to today as an HQ day of a submitted DCR and does not use places.

## Decisions / assumptions for lead to confirm

1. Distance from a **standard fare chart** (place per HQ with fixed one-way km), not GPS. GPS distance can come later as a cross-check.
2. TA for ex-HQ/outstation = **round trip every day** (2 × one-way km). Real policies often pay outstation TA only on the out and return days of a multi-day trip; not modelled.
3. DA is a flat amount per band per day (no half-day DA, no hotel-vs-no-hotel split, no city-class tiers).
4. Rates may differ **by role** (optional); no grade/designation beyond roles.
5. Only `submitted`/`locked` DCRs count (draft DCR days are skipped with `dcr_not_submitted`).
6. Rate card and fare chart are managed with `settings:write` (System Admin / Director); reps and managers can read them with `expenses:read` (accountant with `finance:read`).
7. No new approval rule: drafted lines go through the normal claim approval. No over-limit routing.

## Blocked on Prajesh (not built)

- Customers' actual fare-chart / rate-card formats (for an import template). Admins enter rows via the API for now.

## Migration

`packages/db/migrations/0034_tada_allowances.sql`: tables `allowance_rates`, `allowance_places` (RLS forced, `tenant_isolation`, row-meta triggers, grants), `expense_lines.source` and `expense_lines.calc`, `expense_lines.allowance_place_id`, and the category check widened with `allowance`.
