# DCR redesign: DB and API plan

Status: agreed design (2026-10-28), not built (except the SFC category contract enum). No 0043 SQL
yet. Terms: HQ = `headquarter` territory; territory = level `territory` under an HQ
(`docs/TERRITORY-MODEL.md`).

## Agreed rules

- SFC category is a fixed enum `ex` | `hq` | `os` (contracts `SfcCategory`); DCR band = `SFC_CATEGORY_BAND`: `ex` -> `ex_hq`, `hq` -> `hq`, `os` -> `outstation`. No band column on routes. A field work type fixes the band (`work_types.allowance_band`: FIELD_HQ, FIELD_EXHQ, FIELD_OUT).
- SFC match = employee + HQ + band. Work With is recorded, never matched. Several matches: the user picks one; its id is stored.
- Meeting (and every non-field work type) never uses SFC: no match, no route, no snapshot. MEETING-category routes never apply.
- Work With = anyone (no restriction).
- TA/DA snapshot frozen on the DCR at submit; later SFC edits never change a submitted DCR.
- Leave on a DCR only references an existing leave request.
- Non-field details in jsonb, validated per work type; location and attendees are free text.
- Explicit `draft` / `submitted` status; `Idempotency-Key` on submit; read-only after submit; changes via the existing correction request (`POST /v1/dcrs/correction-requests`).
- Tour-plan deviation is checked against the chosen band and territories.
- Stockists' territory link: later (column exists from 0042, unused). BMs filter by HQ only. Importer auto-creates new territories (next build item).

## Several territories on one field day

Today `dcrs.territory_ids uuid[]` accepts any ids in the user's scope (any level). It stays an array;
each id must now be an HQ or a `territory` in scope (`422 VALIDATION` otherwise).

- Each id resolves to its HQ (itself, or the parent of a `territory`). All ids must resolve to ONE HQ,
  stored as `hq_territory_id`; otherwise `422 MULTIPLE_HQ` (`details.hqIds`). Territories under one HQ
  share one SFC route set, so the day stores one `sfc_route_id`.
- The route must belong to the user, have `hq_territory_id` = that HQ, be live, and its category must
  map to the day's band, else `422 SFC_MISMATCH`. Match endpoint with nothing found: `404 SFC_NO_MATCH`;
  submit of a field day without a route: `422 SFC_ROUTE_REQUIRED`.
- Why one HQ: SFC and TA/DA are per employee + HQ today. A per-HQ list (`sfcRoutes[]`) can be added
  later without breaking clients if a real cross-HQ day appears.

## Non-field details (`details` jsonb, validated per work type)

Day date = the DCR date; times `HH:mm` (IST); strings trimmed. Required/optional split is our proposal.

| Work type (`kind`)             | Field                  | Rule                                                                                |
| ------------------------------ | ---------------------- | ----------------------------------------------------------------------------------- |
| MEETING (`meeting`)            | `title`                | required, 1-120 (meeting type/name)                                                 |
|                                | `mode`                 | required, `in_person` or `online`                                                   |
|                                | `location`             | required when `in_person` (max 200); optional when `online` (link or text)          |
|                                | `startTime`            | required, `HH:mm`                                                                   |
|                                | `durationMin`          | required, int 1-720                                                                 |
|                                | `attendees`            | optional free text, max 500                                                         |
|                                | `remarks`              | optional, max 1000                                                                  |
| TRAINING (`training`)          | as meeting + `trainer` | `trainer` optional free text, max 120                                               |
| OFFICE / Admin work (`office`) | `taskType`             | required, 1-60                                                                      |
|                                | `description`          | required, 1-1000                                                                    |
|                                | `startTime`            | optional, `HH:mm`                                                                   |
|                                | `durationMin`          | required, int 1-720                                                                 |
|                                | `remarks`              | optional, max 1000                                                                  |
| LEAVE (`leave`)                | `leaveRequestId`       | required; a leave request of the user covering the date, else `422 LEAVE_NOT_FOUND` |
| HOLIDAY, field types           |                        | `details` must be null                                                              |

Contracts (zod): `DcrMeetingDetails`, `DcrTrainingDetails` (meeting + trainer), `DcrOfficeDetails`,
`DcrLeaveDetails`; `DcrDetails` = discriminated union on `kind`. The server checks `kind` against the
work type code (`422 VALIDATION`).

## Migration 0043 (outline only)

`dcrs` (additive; existing rows: `status = 'submitted'` where `submitted_at` is set, else `draft`):

| Column                   | Type                                      | Notes                                                                                          |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `status`                 | text `draft`/`submitted`, default `draft` | backfilled from `submitted_at`                                                                 |
| `band`                   | text `hq`/`ex_hq`/`outstation`, null      | field days only                                                                                |
| `hq_territory_id`        | uuid FK `territories`, null               | the day's single HQ (field days)                                                               |
| `sfc_route_id`           | uuid FK `sfc_routes`, null                | chosen route                                                                                   |
| `sfc_snapshot`           | jsonb, null                               | frozen at submit: route id, from/to, km, amounts, actual fare, mode, category, DA, rate per km |
| `details`                | jsonb, null                               | non-field details (shapes above)                                                               |
| `work_with_user_ids`     | uuid[] default `{}`                       | day-level Work With                                                                            |
| `submitted_by`           | uuid FK `users`, null                     |                                                                                                |
| `submit_idempotency_key` | text, null                                | unique per (company, user)                                                                     |

Checks: `status = 'submitted'` requires `submitted_at`; a route requires `band`; non-field days have no
`sfc_route_id`; `details IS NULL OR jsonb_typeof(details) = 'object'` (shape validated by zod).
`sfc_routes`: `CHECK (category IS NULL OR category IN ('ex','hq','os')) NOT VALID` (guards new and
edited rows); `VALIDATE CONSTRAINT` in a later migration after the category data fix, once no misfits
remain. `dcr_calls` unchanged.

## Endpoints (`/v1/dcrs`, own DCRs; writes need `field:write`)

| Method / path                                   | Request                                                                                                                                                   | Response                                                                                               | Errors                                                                                                                                                                                                                         |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /options?date=`                            |                                                                                                                                                           | work types (`id, code, kind, band`), the draft for that date or null                                   | 422 VALIDATION                                                                                                                                                                                                                 |
| `GET /territories?date=&band=`                  |                                                                                                                                                           | user's HQs, each with its `territory` children (`id, code, name, level`)                               | 422                                                                                                                                                                                                                            |
| `GET /work-with?q=`                             |                                                                                                                                                           | active users (`id, name, role, hq`), search, paged                                                     |                                                                                                                                                                                                                                |
| `GET /sfc-match?date=&band=&hqId=` (field only) |                                                                                                                                                           | `routes[]` (id, from, to, km, amounts, actualFare, mode, category, da) whose category maps to the band | 404 SFC_NO_MATCH, 503 SFC_UNAVAILABLE (retryable), 422                                                                                                                                                                         |
| `PUT /draft`                                    | `{date, workTypeId, band?, territoryIds[], workWithUserIds[], sfcRouteId?, details?, calls[]: {outletKind, outletId, calledAt, ...existing call fields}}` | `{id, status:'draft', version, hqTerritoryId, ...}`                                                    | 409 ALREADY_SUBMITTED, 409 DAY_LOCKED, 422 VALIDATION, 422 MULTIPLE_HQ, 422 SFC_MISMATCH                                                                                                                                       |
| `POST /{id}/submit` + `Idempotency-Key`         | `{version}`                                                                                                                                               | full DCR, `status:'submitted'`, `sfcSnapshot`                                                          | 409 ALREADY_SUBMITTED (same key returns the first result), 409 VERSION_CONFLICT, 409 DAY_LOCKED, 422 VALIDATION, 422 MULTIPLE_HQ, 422 SFC_MISMATCH, 422 SFC_ROUTE_REQUIRED, 422 DEVIATION_REASON_REQUIRED, 422 LEAVE_NOT_FOUND |
| `GET /{id}`                                     |                                                                                                                                                           | DCR with calls, snapshot, details                                                                      | 404                                                                                                                                                                                                                            |

Drafts may be partial; submit re-checks everything server-side: permission and tenant; one HQ; route
owner/HQ/band/live; outlets in scope; details per work type; leave reference; tour-plan deviation
reason. The existing `PUT /v1/dcrs` stays for current clients until web/app move over.

## SFC category enum (built on this branch: contracts only)

- `SfcRouteInput.category` = `SfcCategory | null`; anything else on the SFC table PUT is `422 VALIDATION` (API and MSW validate with the schema). OpenAPI regenerated.
- Transition (simplest backward-compatible): response `SfcRoute.category` stays `string | null` until the data fix has run, so legacy rows still read. Edit UI: a value outside `ex`/`hq`/`os` is shown and must be re-chosen before save (the PUT sends the full table, so it cannot be re-sent unchanged). After the fix, a later contract change narrows the response to `SfcCategory | null`.
- To do (Dev): the SFC importer (`apps/api/src/sfc/sfc-import.ts`, `normCategory`) still stores raw text; map to the enum with the data-fix key rules, report misfits, adjust the upsert key.
- Data fix `packages/db/scripts/data-fixes/2026-10-28-sfc-category-normalise.sql` (not applied anywhere). Would change, from the 6 SFC sheets as imported:

| Current value (rows)      | Result                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `EX` (31), `EX HQ` (6)    | `ex` (37)                                                                                                                                  |
| `HQ` (6)                  | `hq` (6)                                                                                                                                   |
| `OS` (1), `OUT EX HQ` (1) | `os` (2)                                                                                                                                   |
| `EX / OS` (2)             | misfit, unchanged by default. Proposal: Prajesh picks; `-v exos=ex` or `-v exos=os` sets both, or split by re-entering in the SFC UI       |
| `MEETING` (16)            | misfit, unchanged by default. Proposal: archive (soft delete, audited, reversible) with `-v meeting=archive`, since Meeting never uses SFC |
| anything else / null      | listed, unchanged                                                                                                                          |
