# DCR redesign: as-built reference

On `main` (checked 2026-11-03, `f29dedb`). Migrations `0043_dcr_redesign`, `0045` (several drafts),
`0046` (KPIs count submitted only), `0048`/`0049` (POB, review), `0050` (tour plan items), `0051`
(unlock), `0052` (expense auto-draft); all applied. Permissions: `field:read` for GETs, `field:write`
for draft/submit (BM and, since 0044, ABM and up), `dcr:review` for decisions. The old `PUT /v1/dcrs` still works; it returns
`409 ALREADY_SUBMITTED` once a DCR was submitted through `POST /v1/dcrs/{id}/submit`.

## Data model

`dcrs` new columns: `band` (`hq | ex_hq | outstation`, null for non-field), `details` (jsonb object),
`work_with_user_ids uuid[]`, `submitted_by`, `submit_idempotency_key` (unique per company + user).

`dcr_sfc_routes` (child table, one row per HQ of the day): `dcr_id`, `hq_territory_id`, `sfc_route_id`,
`snapshot` (jsonb, filled at submit). Unique live `(company_id, dcr_id, hq_territory_id)`. RLS forced,
tenant policy, `set_row_meta` trigger.

`sfc_routes.category` has **no DB CHECK**. The rule is app-level: zod `SfcCategory` (`hq | ex | os`),
the importer mapping, and DCR matching ignores any other value. Reason: the 2 `EX / OS` and 16 `MEETING`
routes stay by decision, so a validated CHECK could never pass.

## Multi-HQ days

- Each picked territory resolves to its HQ (an HQ itself or a `territory` child). Several HQs are allowed.
- Work type band -> categories: `hq` -> `hq`; `ex_hq` -> `ex`; `outstation` -> `os`.
- Candidates per HQ: the employee's own live routes on that HQ in the band, else the HQ fallback (below).
- One route per HQ. Draft may set `sfcRoutes`; omitting it keeps saved choices. At submit an HQ with no
  choice and one candidate is auto-picked; none -> `422 SFC_NO_MATCH`; several -> `422 SFC_ROUTE_REQUIRED`.
- A choice for an HQ not on the day, or a route that is not a candidate -> `422 SFC_MISMATCH`.
- Non-field work types (Meeting, Training, Office, Leave) have no band and no SFC; `sfcRoutes` is rejected.

## Details (`details.kind` must equal the work type's `detailsKind`)

| kind       | Fields                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meeting`  | `title` 1-120, `mode` `in_person \| online`, `location` <=200 (required in person), `startTime` HH:mm, `durationMin` 1-720, `attendees?` <=500, `remarks?` <=1000 |
| `training` | as meeting + `trainer?` <=120                                                                                                                                     |
| `office`   | `taskType` 1-60, `description` 1-1000, `startTime?`, `durationMin`, `remarks?`                                                                                    |
| `leave`    | `leaveRequestId`; submit needs a pending/approved leave request covering the date (`LEAVE_NOT_FOUND`)                                                             |

`detailsKind`: leave work type -> `leave`; non-field code containing `MEET` -> `meeting`, `TRAIN` ->
`training`, other non-field -> `office`; field -> none.

## Snapshot (frozen at submit, per HQ)

`{sfcRouteId, routeVersion, hqTerritoryId, fromPlace, toPlace, oneWayKm, bothWayKm, oneWayAmount,
bothWayAmount, actualFare, travelMode, category, band, da, ratePerKm, frozenAt}`. Later SFC edits never
change a submitted DCR.

## Endpoints (`/v1/dcrs`)

| Endpoint                                            | Request                                                                                                                                                     | Response                                                                                                          | Errors                                                                                                                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /options?date=`                                |                                                                                                                                                             | `{date, workTypes[{id, code, name, kind, band, usesSfc, detailsKind}], dcr \| null, submitted \| null, drafts[]}` | 422                                                                                                                                                                                                                 |
| `GET /territories`                                  |                                                                                                                                                             | `{items[{id, code, name, territories[{id, code, name}]}]}` (HQs in scope)                                         |                                                                                                                                                                                                                     |
| `GET /work-with?q=&limit=`                          |                                                                                                                                                             | `{items[{id, name, employeeCode, designation}]}`                                                                  |                                                                                                                                                                                                                     |
| `GET /sfc-match?date=&workTypeId=&territoryIds=a,b` |                                                                                                                                                             | `{band, hqs[{hqTerritoryId, hqName, candidates[], autoSelectedId}]}`                                              | 404 SFC_NO_MATCH (`{band, hqs, missingHqIds}`), 422, 503 SFC_UNAVAILABLE                                                                                                                                            |
| `PUT /draft`                                        | `{id?, date, workTypeId, band?, territoryIds[], workWithUserIds[], sfcRoutes?[{hqTerritoryId, sfcRouteId}], details?, deviationReason?, calls[], version?}` | `Dcr` (status `draft`)                                                                                            | 404 (id); 409 ALREADY_SUBMITTED / DAY_ALREADY_SUBMITTED / DAY_LOCKED / VERSION_CONFLICT; 422 DCR_DATE_NOT_TODAY / VALIDATION / SFC_MISMATCH                                                                         |
| `DELETE /{id}`                                      |                                                                                                                                                             | 204                                                                                                               | 404; 409 ALREADY_SUBMITTED / DAY_LOCKED                                                                                                                                                                             |
| `POST /{id}/submit` + `Idempotency-Key`             | `{version}`                                                                                                                                                 | `Dcr` (status `submitted`, `sfcRoutes[].snapshot`)                                                                | 404; 409 ALREADY_SUBMITTED / DAY_ALREADY_SUBMITTED / IDEMPOTENCY_CONFLICT / VERSION_CONFLICT / DAY_LOCKED; 422 DCR_DATE_NOT_TODAY / VALIDATION / SFC_NO_MATCH / SFC_ROUTE_REQUIRED / SFC_MISMATCH / LEAVE_NOT_FOUND |
| `GET /{id}`                                         |                                                                                                                                                             | `Dcr`                                                                                                             | 404                                                                                                                                                                                                                 |

Same key retried after success returns the same DCR with 200. Field days need territories and at least one call.

### Several drafts, one submitted report per day (0045)

A user may keep several drafts for a date; at most one live report per day is `submitted`/`approved`
(partial unique index `dcrs_user_date_submitted_uq`). `PUT /draft` with `id` updates that draft;
without `id` it creates a new one (without `id` but with `version`: the latest draft, for older
clients). `DELETE /{id}` soft-deletes a draft. Readers that need "the DCR of a day" use the **day
report**: the submitted one, else the latest draft (`apps/api/src/dcr/day-report.ts`,
`kpi_user_day`, `dcr_day_calls`).

## Review, lock, unlock and cross-module rules

- Deviation from the tour plan no longer needs a reason (a1ba83c). Approved tour plans and tour plan
  items (0050, `/v1/tour-plans/items`) appear as `tourPlanDrafts` in `GET /options`; a draft may carry
  `tourPlanId` / `tourPlanItemId`.
- Date rule (today only): `PUT /v1/dcrs`, `PUT /draft` and `POST /{id}/submit` accept only today in
  Asia/Kolkata (`dcrToday`, `apps/api/src/dcr/dcr-date.ts`; never the server zone). Future dates are
  rejected (also from a tour plan item; tour plans themselves are unchanged). A past date is accepted
  only while the day is unlocked (`unlockedUntil`: director-approved correction, or a manager
  rejection reopening it for 48 h), so an unlocked/returned DCR can be fixed and re-submitted. Order:
  a locked past day still answers `409 DAY_LOCKED` (request a correction); otherwise
  `422 DCR_DATE_NOT_TODAY` (`details: date, today`). A director's own past day never locks but is
  not unlocked either, so it is rejected too. GETs, delete of a draft, review decisions and
  unlock decisions are unaffected.
- Submit: doctor calls with detailed products need `presentationOpenedAt` (422 VALIDATION,
  `PRESENTATION_NOT_OPENED`); POB is valued at PTS (0048).
- `POST /{id}/decision` (`dcr:review`, ABM and up + system_admin, reporting line): approve, or reject
  with a comment (`rejectionReason`). A director's own DCR is approved at submit and never locks.
- Day lock: 00:00 IST the next day (`lockAtOf`); a locked day returns `409 DAY_LOCKED`. Unlock /
  correction requests (`POST /v1/dcrs/correction-requests`) are decided by directors only
  (`dcr_unlock:decide`, 0051; not system_admin).
- Expense approval needs an APPROVED DCR for every expense date of the claim owner, else
  `409 DCR_NOT_APPROVED` (`details: dates, dcrIds, dcrStatus`).
- Leave approval is blocked while a submitted/approved DCR exists on a leave date:
  `409 LEAVE_DCR_CONFLICT` (`dates, dcrIds`); drafts never block.
- KPIs, team calendar, leave clash and team attendance count submitted/approved reports only (0046).
- Expense auto-draft on DCR submit (0052): per company flag `auto_expense_on_dcr_submit`, default off;
  lines of a later rejected DCR are flagged `dcr_rejected_at`.

## SFC candidates: own routes, else the HQ's routes (fallback)

`sfc_routes` are owned per user. The candidate set for each HQ of the day (one function,
`apps/api/src/dcr/sfc-resolve.ts`, used by `sfc-match`, draft/submit validation and the submit
snapshot, so TA/DA always come from the same route):

- **Own wins, per HQ**: if the filer has any live (`deleted_at` null) route on that HQ, of any
  category, only the filer's routes on that HQ in the day's band count (`sort_order`, then id).
  So a filer with own HQ-only routes who picks EX on that HQ gets `SFC_NO_MATCH`, not the fallback.
- **HQ fallback**: no own route on that HQ -> every owner's live routes on that HQ in the band,
  de-duplicated on (normalised `from_place`, normalised `to_place`, `category`); normalised = upper
  case, non-alphanumerics removed. Winner: lowest `sort_order`, then oldest `created_at`, then lowest
  id. Ordered by the same key.
- Decided per HQ, so a multi-HQ day can mix own and fallback HQs.
- Reads go through the tenant transaction: RLS keeps them inside the company; no service role.
- Candidates and snapshots carry optional `source: 'own' | 'hq'`; the snapshot freezes the chosen
  route (`sfcRouteId`, `routeVersion`) whoever owns it.

## Data fix

`packages/db/scripts/data-fixes/2026-10-28-sfc-category-normalise.sql`: dry run by default, `-v apply=1`
to write. `EX`, `EX HQ` -> `ex`; `HQ` -> `hq`; `OS`, `OUT EX HQ` -> `os`. `EX / OS` and `MEETING` are
kept as is and listed. Re-runnable.

## Meeting sub-types, DCR expenses, end time and places (contract 2026-11-03, server pending)

- Meeting sub-type = `details.title`, one of "Cycle Meeting" / "Review Meeting" on write (DCR
  and TP); anything else is 422 MEETING_TYPE_INVALID. Before this, title was free text. Old rows
  are never rewritten destructively: the data fix
  `packages/db/scripts/data-fixes/<date>-meeting-title-normalise.sql` (dry-run default) only
  rewrites titles that clearly say "cycle" or "review" to the exact label (old text kept in the
  audit/notes); everything else displays its legacy title. Reads tolerate legacy values.
- Meeting, training and admin work (office) get `endTime`; the server derives `durationMin`
  (end - start, same day, 1-720). end <= start -> 422 END_TIME_NOT_AFTER_START, more than 12 h -> 422 DURATION_TOO_LONG.
  Admin work: startTime becomes required whenever endTime is sent. Older clients
  that send only `durationMin` keep working until endTime becomes required.
- Meeting and admin work get optional `fromPlace` / `toPlace` (no TA/DA rule reads them yet, so
  nothing justifies making them mandatory). Training: no places.
- Any work type can carry `expenses[]` (travel, hotel, food, other). At submit they are copied
  into the month claim as `origin: dcr` lines (`dcrId`), replacing all of that DCR's
  earlier dcr lines, so a resubmit never duplicates. Same rules as the TA/DA auto-draft: only a
  draft/rejected claim is written (created if missing); a submitted/approved/paid claim is left
  alone (`dcrExpenses.status skipped, reason claim_locked`), the DCR keeps the items and the user
  adds them after the claim reopens. Claims are one per user per month, so a second draft claim
  is not possible without a schema change. A DCR rejection removes its dcr lines from an
  editable claim and flags them (dcr_rejected_at) on a decided one, as for TA/DA.
- New fields live in `dcrs.details` (jsonb) and need no migration; expenses need a table.
