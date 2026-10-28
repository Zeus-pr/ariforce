# DCR redesign: DB and API plan

Status: agreed design (2026-10-28), not built. No migration SQL yet. Terms: HQ = `headquarter`
territory; territory = level `territory` under an HQ (`docs/TERRITORY-MODEL.md`).

## Agreed rules

- Band = `sfc_routes.category` mapped to `hq` / `ex_hq` / `outstation` (table in `docs/TERRITORY-MODEL.md`); no band column on routes. A field work type fixes the band (`work_types.allowance_band`).
- SFC match = employee + HQ + band. Work With is recorded, never matched. Several matches: the user picks one; its id is stored.
- Work With = anyone (no restriction).
- TA/DA snapshot frozen on the DCR at submit; later SFC edits never change a submitted DCR.
- Leave on a DCR only references an existing leave request.
- Non-field details in jsonb, validated per work type; location and attendees are free text.
- Explicit `draft` / `submitted` status; `Idempotency-Key` on submit; read-only after submit; changes via the existing correction request (`POST /v1/dcrs/correction-requests`).
- Tour-plan deviation is checked against the chosen band and territory.

## Migration 0043 (outline only)

`dcrs` (all additive, nullable or defaulted; existing rows become `submitted` when `submitted_at` is set, else `draft`):

| Column                   | Type                                      | Notes                                                                                          |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `status`                 | text `draft`/`submitted`, default `draft` | backfilled from `submitted_at`                                                                 |
| `band`                   | text `hq`/`ex_hq`/`outstation`, null      | field days only                                                                                |
| `sfc_route_id`           | uuid FK `sfc_routes`, null                | chosen route                                                                                   |
| `sfc_snapshot`           | jsonb, null                               | frozen at submit: route id, from/to, km, amounts, actual fare, mode, category, DA, rate per km |
| `details`                | jsonb, null                               | non-field details per work type (incl. `leaveRequestId`)                                       |
| `work_with_user_ids`     | uuid[] default `{}`                       | day-level Work With                                                                            |
| `submitted_by`           | uuid FK `users`, null                     |                                                                                                |
| `submit_idempotency_key` | text, null                                | unique per (company, user)                                                                     |

Checks: `status = 'submitted'` requires `submitted_at`; a field day with a route requires `band`.
`sfc_routes`: no change (an SQL/TS helper maps category to band). `dcr_calls` unchanged.

## Endpoints (all `/v1/dcrs`, own DCRs, `field:write` for writes)

| Method / path                           | Request                                                                                                                                                        | Response                                                                 | Errors                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /options?date=`                    |                                                                                                                                                                | work types (`id, code, kind, band`), draft for that date or null         | 422 VALIDATION                                                                                                                                                                        |
| `GET /territories?date=&band=`          |                                                                                                                                                                | user's HQs, each with its `territory` children (`id, code, name, level`) | 422                                                                                                                                                                                   |
| `GET /work-with?q=`                     |                                                                                                                                                                | active users (`id, name, role, hq`), search, paged                       |                                                                                                                                                                                       |
| `GET /sfc-match?date=&band=&hqId=`      |                                                                                                                                                                | `routes[]` (id, from, to, km, amounts, actualFare, mode, category, da)   | 404 SFC_NO_MATCH, 503 SFC_UNAVAILABLE (retryable), 422                                                                                                                                |
| `PUT /draft`                            | `{date, workTypeId, band?, hqId?, territoryId?, workWithUserIds[], sfcRouteId?, details?, calls[]: {outletKind, outletId, calledAt, ...existing call fields}}` | `{id, status:'draft', version, ...}`                                     | 409 ALREADY_SUBMITTED, 409 DAY_LOCKED, 422 VALIDATION (per-field), 422 SFC_MISMATCH                                                                                                   |
| `POST /{id}/submit` + `Idempotency-Key` | `{version}`                                                                                                                                                    | full DCR, `status:'submitted'`, `sfcSnapshot`                            | 409 ALREADY_SUBMITTED (same key returns the first result), 409 VERSION_CONFLICT, 409 DAY_LOCKED, 422 VALIDATION, 422 SFC_MISMATCH, 422 DEVIATION_REASON_REQUIRED, 422 LEAVE_NOT_FOUND |
| `GET /{id}`                             |                                                                                                                                                                | DCR with calls, snapshot, details                                        | 404                                                                                                                                                                                   |

Submit re-checks on the server: permissions and tenant; route owner = user, route HQ = chosen HQ,
mapped band = work-type band, route live; territory under the HQ; each outlet in the user's scope;
required details for the work type; Leave references an existing leave request of that user and date;
tour-plan deviation reason. Existing `PUT /v1/dcrs` stays for current clients until web/app move over.

## Open (to confirm at build time)

- Exact required `details` fields per work type (meeting, training, office/admin, leave).
- Whether a field day may have several territories (today `territory_ids[]`); plan: one HQ + optional territory.
